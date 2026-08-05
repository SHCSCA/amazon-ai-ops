import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type StoreConnection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
  type VisibleBrowserControllerLike,
  type VisibleBrowserRuntimeCandidate,
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

function operatorCandidate(options: {
  lingxing?: ReturnType<typeof controller>;
  amazonAds?: ReturnType<typeof controller>;
  contextOverride?: Partial<StoreContextEnvelope>;
  amazonAdsIdentityStatus?: 'unknown' | 'pending' | 'blocked';
  attempt?: VisibleBrowserRuntimeCandidate['attempt'];
} = {}): VisibleBrowserRuntimeCandidate {
  const runtimeContext = context(options.contextOverride);
  return {
    purpose: 'operator_full',
    context: runtimeContext,
    controllers: {
      lingxing: options.lingxing ?? controller(),
      amazonAds: options.amazonAds ?? controller(),
    },
    profileDirs: {
      lingxing: 'D:\\capsules\\store-one\\lingxing',
      amazonAds: 'D:\\capsules\\store-one\\amazon-ads',
    },
    connections: {
      lingxing: {
        id: 'connection-lingxing' as StoreConnection['id'],
        provider: 'lingxing',
        storeId: runtimeContext.storeId,
        status: 'ready',
        externalAccountId: 'seller-one',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      amazonAds: {
        id: 'connection-amazon-ads' as StoreConnection['id'],
        provider: 'amazon_ads',
        storeId: runtimeContext.storeId,
        status: 'ready',
        externalAccountId: 'ads-one',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    },
    amazonAdsIdentityStatus: options.amazonAdsIdentityStatus ?? 'pending',
    ...(options.attempt ? { attempt: options.attempt } : {}),
  };
}

describe('VisibleBrowserRuntimeRegistry', () => {
  it('CAS-verifies Amazon Ads identity only for the exact operator runtime and invalidates old claims', () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'operator-runtime');
    const published = registry.publishCandidate(operatorCandidate({
      attempt: { kind: 'manual', attemptId: 'operator-login', attemptEpoch: 9 },
    }));
    const lingxingVerified = registry.verifyLingxingCandidate(published);
    const identityClaim = registry.claimAmazonAdsIdentity({
      runtimeId: lingxingVerified.runtime.runtimeId,
      epoch: lingxingVerified.runtime.epoch,
      context: context(),
    });

    const verified = registry.verifyAmazonAdsIdentity(identityClaim);

    expect(verified.providerIdentityStatus).toEqual({
      lingxing: 'verified',
      amazonAds: 'verified',
    });
    expect(Object.isFrozen(verified)).toBe(true);
    expect(verified.epoch).toBe(lingxingVerified.runtime.epoch + 1);
    expect(registry.read()).toBe(verified);
    expect(() => registry.assertClaimCurrent(lingxingVerified)).toThrow(/replayed|changed/);
    expect(() => registry.verifyAmazonAdsIdentity(identityClaim)).toThrow(/replayed/);
  });

  it('atomically replaces a pending Ads enrollment connection when trusted identity is confirmed', () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'operator-enrollment-runtime');
    const candidate = operatorCandidate();
    const pendingAds = {
      ...candidate.connections!.amazonAds!,
      status: 'not_configured' as const,
      externalAccountId: undefined,
      normalizedExternalAccountId: undefined,
    };
    const published = registry.publishCandidate({
      ...candidate,
      connections: { ...candidate.connections!, amazonAds: pendingAds },
    });
    const lingxingVerified = registry.verifyLingxingCandidate(published);
    const identityClaim = registry.claimAmazonAdsIdentity({
      runtimeId: lingxingVerified.runtime.runtimeId,
      epoch: lingxingVerified.runtime.epoch,
      context: context(),
    });
    const enrolledAds = {
      ...pendingAds,
      status: 'ready' as const,
      externalAccountId: 'profile-auto-100',
      normalizedExternalAccountId: 'profile-auto-100',
      updatedAt: '2026-07-01T00:01:00.000Z',
    };

    const verified = registry.verifyAmazonAdsIdentity(identityClaim, enrolledAds);

    expect(verified.providerIdentityStatus.amazonAds).toBe('verified');
    expect(verified.connections?.amazonAds).toEqual(enrolledAds);
    expect(Object.isFrozen(verified.connections?.amazonAds)).toBe(true);
  });

  it('rejects a confirmed Ads connection that does not belong to the exact runtime store', () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'operator-enrollment-runtime');
    const published = registry.publishCandidate(operatorCandidate());
    const lingxingVerified = registry.verifyLingxingCandidate(published);
    const identityClaim = registry.claimAmazonAdsIdentity({
      runtimeId: lingxingVerified.runtime.runtimeId,
      epoch: lingxingVerified.runtime.epoch,
      context: context(),
    });
    const wrongStore = {
      ...lingxingVerified.runtime.connections!.amazonAds!,
      storeId: 'store-two' as StoreConnection['storeId'],
    };

    expect(() => registry.verifyAmazonAdsIdentity(identityClaim, wrongStore))
      .toThrow(/confirmed Amazon Ads connection/);
  });

  it('rejects collection-only, forged, cross-context, and blocked-to-verified Ads transitions', () => {
    const collection = new VisibleBrowserRuntimeRegistry(() => 'collection-runtime');
    const collectionClaim = collection.publishCandidate(candidate());
    expect(() => collection.claimAmazonAdsIdentity({
      runtimeId: collectionClaim.runtime.runtimeId,
      epoch: collectionClaim.runtime.epoch,
      context: context(),
    })).toThrow(/operator_full/);

    const operator = new VisibleBrowserRuntimeRegistry(() => 'operator-runtime');
    const published = operator.publishCandidate(operatorCandidate({
      amazonAdsIdentityStatus: 'blocked',
    }));
    const lingxingVerified = operator.verifyLingxingCandidate(published);
    expect(() => operator.claimAmazonAdsIdentity({
      runtimeId: lingxingVerified.runtime.runtimeId,
      epoch: lingxingVerified.runtime.epoch,
      context: context({ businessDate: '2026-07-31' as StoreContextEnvelope['businessDate'] }),
    })).toThrow(/exact runtime, epoch, or context/);

    const blockedClaim = operator.claimAmazonAdsIdentity({
      runtimeId: lingxingVerified.runtime.runtimeId,
      epoch: lingxingVerified.runtime.epoch,
      context: context(),
    });
    expect(() => operator.verifyAmazonAdsIdentity({ ...blockedClaim })).toThrow(/forged/);
    expect(() => operator.verifyAmazonAdsIdentity(blockedClaim)).toThrow(/blocked.*cannot become verified/);
    expect(() => operator.verifyAmazonAdsIdentity(blockedClaim)).toThrow(/replayed/);
  });

  it('revokes an unconsumed Ads claim across strict close and a fresh runtime epoch', async () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'stable-runtime-name');
    const firstPublished = registry.publishCandidate(operatorCandidate());
    const firstVerified = registry.verifyLingxingCandidate(firstPublished);
    const oldAdsClaim = registry.claimAmazonAdsIdentity({
      runtimeId: firstVerified.runtime.runtimeId,
      epoch: firstVerified.runtime.epoch,
      context: context(),
    });
    await registry.strictCloseCurrent(context());
    const secondPublished = registry.publishCandidate(operatorCandidate({
      contextOverride: { sessionGeneration: 8 },
    }));
    registry.verifyLingxingCandidate(secondPublished);

    expect(() => registry.verifyAmazonAdsIdentity(oldAdsClaim)).toThrow(/replayed|changed/);
    expect(registry.read()?.epoch).toBeGreaterThan(oldAdsClaim.epoch);
  });

  it('can fail closed from verified to blocked but never return blocked to verified', () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'operator-runtime');
    const published = registry.publishCandidate(operatorCandidate());
    const lingxingVerified = registry.verifyLingxingCandidate(published);
    const verifyClaim = registry.claimAmazonAdsIdentity({
      runtimeId: lingxingVerified.runtime.runtimeId,
      epoch: lingxingVerified.runtime.epoch,
      context: context(),
    });
    const verified = registry.verifyAmazonAdsIdentity(verifyClaim);
    const blockClaim = registry.claimAmazonAdsIdentity({
      runtimeId: verified.runtimeId,
      epoch: verified.epoch,
      context: context(),
    });
    const blocked = registry.blockAmazonAdsIdentity(blockClaim);
    const forbiddenVerify = registry.claimAmazonAdsIdentity({
      runtimeId: blocked.runtimeId,
      epoch: blocked.epoch,
      context: context(),
    });

    expect(blocked.providerIdentityStatus.amazonAds).toBe('blocked');
    expect(blocked.epoch).toBe(verified.epoch + 1);
    expect(() => registry.verifyAmazonAdsIdentity(forbiddenVerify))
      .toThrow(/blocked.*cannot become verified/);
  });

  it.each([
    ['missing Ads controller', () => {
      const valid = operatorCandidate();
      return { ...valid, controllers: { lingxing: valid.controllers.lingxing } };
    }],
    ['aliased provider controllers', () => {
      const valid = operatorCandidate();
      const shared = controller();
      return { ...valid, controllers: { lingxing: shared, amazonAds: shared } };
    }],
    ['missing Ads profile', () => {
      const valid = operatorCandidate();
      return { ...valid, profileDirs: { lingxing: valid.profileDirs!.lingxing } };
    }],
    ['normalized profile alias', () => {
      const valid = operatorCandidate();
      return {
        ...valid,
        profileDirs: {
          lingxing: 'D:\\Capsules\\Store-One\\LingXing\\',
          amazonAds: 'd:/capsules/store-one/lingxing',
        },
      };
    }],
    ['missing Ads connection', () => {
      const valid = operatorCandidate();
      return {
        ...valid,
        connections: { lingxing: valid.connections!.lingxing },
      };
    }],
  ])('rejects incomplete or aliased operator_full provider isolation: %s', (_label, build) => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'invalid-operator-runtime');

    expect(() => registry.publishCandidate(build() as VisibleBrowserRuntimeCandidate))
      .toThrow(/distinct Lingxing\/Amazon Ads controllers, profiles, and connections/);
    expect(registry.read()).toBeNull();
  });

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
    const claim = registry.publishCandidate(operatorCandidate({
      lingxing,
      amazonAds,
      attempt: { kind: 'manual', attemptId: 'login-one', attemptEpoch: 4 },
    }));

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
    const claim = manual.publishCandidate(operatorCandidate({
      attempt: {
        kind: 'manual',
        attemptId: 'login-attempt',
        attemptEpoch: 12,
      },
      amazonAdsIdentityStatus: 'blocked',
    }));
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
    const manualClaim = registry.publishCandidate(operatorCandidate({
      lingxing: browser,
      attempt: { kind: 'manual', attemptId: 'manual-login', attemptEpoch: 3 },
      amazonAdsIdentityStatus: 'unknown',
    }));
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

  it('terminally seals shutdown close and keeps its exact empty proof idempotent', async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const registry = new VisibleBrowserRuntimeRegistry(() => 'terminal-runtime');
    const browser = controller({
      close: async () => {
        await closeGate;
        browser.setResidue(null, null);
      },
    });
    registry.publishCandidate(candidate(browser));

    const sealing = registry.closeAllAndSeal();
    const concurrentClose = registry.closeAll();
    expect(concurrentClose).toBe(sealing);
    expect(() => registry.publishCandidate(candidate())).toThrow(/terminally sealed/);
    expect(() => registry.claimCurrent()).toThrow(/terminally sealed/);

    releaseClose();
    const firstProof = await sealing;
    const secondProof = await registry.closeAllAndSeal();
    const ordinaryCloseProof = await registry.closeAll();

    expect(firstProof).toBe(secondProof);
    expect(firstProof).toBe(ordinaryCloseProof);
    expect(browser.close).toHaveBeenCalledOnce();
    registry.consumeEmptyProof(firstProof);
    registry.consumeEmptyProof(firstProof);
    expect(() => registry.publishCandidate(candidate())).toThrow(/terminally sealed/);
    expect(() => registry.claimCurrent()).toThrow(/terminally sealed/);
    expect(registry.read()).toBeNull();
  });

  it('keeps terminal admission sealed while retrying a failed controller close', async () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'failed-terminal-runtime');
    let closeAttempts = 0;
    const browser = controller({
      close: async () => {
        closeAttempts += 1;
        if (closeAttempts === 1) throw new Error('terminal close failed');
        browser.setResidue(null, null);
      },
    });
    registry.publishCandidate(candidate(browser));

    const sealing = registry.closeAllAndSeal();
    await expect(sealing).rejects.toThrow(/close failed/i);

    expect(() => registry.publishCandidate(candidate())).toThrow(/terminally sealed/i);
    expect(() => registry.claimCurrent()).toThrow(/terminally sealed/i);
    expect(registry.read()).not.toBeNull();
    expect(browser.close).toHaveBeenCalledOnce();

    const retriedProof = await registry.closeAllAndSeal();
    expect(browser.close).toHaveBeenCalledTimes(2);
    expect(registry.read()).toBeNull();
    expect(await registry.closeAllAndSeal()).toBe(retriedProof);
    expect(await registry.closeAll()).toBe(retriedProof);
    expect(() => registry.publishCandidate(candidate())).toThrow(/terminally sealed/i);
    expect(() => registry.claimCurrent()).toThrow(/terminally sealed/i);
  });
});

describe('StoreMutationLane', () => {
  it('enters an irreversible sticky-unknown state and retains the exact held claim', () => {
    const lane = new StoreMutationLane();
    const capability = Object.freeze({});
    lane.registerAuthority({ kind: 'user', owner: 'renderer-store-ipc', capability });
    const claim = lane.claim({ kind: 'user', owner: 'renderer-store-ipc', capability });

    const snapshot = lane.markSafetyStateUnknown();

    expect(snapshot).toEqual({
      state: 'sticky_unknown',
      held: true,
      stickyUnknown: true,
      sequence: 1,
      current: { kind: 'user', owner: 'renderer-store-ipc', sequence: 1 },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => lane.release(claim)).toThrow(/safety state is unknown/i);
    expect(() => lane.registerAuthority({
      kind: 'automation',
      owner: 'daily-collection',
      capability: Object.freeze({}),
    })).toThrow(/safety state is unknown/i);
    expect(lane.inspect()).toEqual(snapshot);
  });

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
