import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  BrowserLeaseManager,
  deriveStoreCapsulePaths,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  normalizeStoreContextEnvelope,
  type BrowserProfileId,
  type StoreConnection,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
  type StoreSessionMetadata,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionExecutionAutomationAuthority,
  type StoreCollectionTransitionCapabilityScope,
  type StoreCollectionVisibleRuntimeIntent,
} from './store-collection-orchestrator';
import {
  StoreCollectionOrchestratorVisibleRuntimeAdapter,
  StoreCollectionVisibleRuntimeAdapterError,
  type CollectionOnlyBrowserController,
  type StoreCollectionVisibleRuntimeAdapterOptions,
} from './store-collection-orchestrator-visible-runtime-adapter';
import type {
  ProviderIdentityPageLike,
  ProviderPageIdentityResult,
} from './provider-page-active-identity';
import { VisibleBrowserRuntimeRegistry } from './visible-browser-runtime-registry';

function context(overrides: Partial<StoreContextEnvelope> = {}): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-30',
    sessionGeneration: 8,
    ...overrides,
  });
}

function store(value = context()): StoreRecord {
  return {
    storeId: value.storeId,
    browserProfileId: value.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    displayName: String(value.storeId),
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function connection(value = context()): StoreConnection {
  return {
    id: `connection-${value.storeId}` as StoreConnection['id'],
    storeId: value.storeId,
    provider: 'lingxing',
    status: 'ready',
    accountLabel: `account-${value.storeId}`,
    externalAccountId: `seller-${value.storeId}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function amazonAdsConnection(value = context()): StoreConnection {
  return {
    id: `ads-connection-${value.storeId}` as StoreConnection['id'],
    storeId: value.storeId,
    provider: 'amazon_ads',
    status: 'ready',
    accountLabel: `ads-account-${value.storeId}`,
    externalAccountId: `ads-${value.storeId}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function page() {
  return {
    url: () => 'https://erp.lingxing.com/erp/home',
    title: vi.fn(async () => 'Lingxing ERP'),
    evaluate: vi.fn(async () => ({
      bodyText: '工作台',
      hasLoginInput: false,
      hasPasswordInput: false,
      hasMfaInput: false,
      domObservations: [],
    })) as ProviderIdentityPageLike['evaluate'],
  };
}

function controller(options: {
  launch?: () => Promise<void>;
  navigate?: (url: string) => Promise<void>;
  close?: () => Promise<void>;
  page?: ReturnType<typeof page> | null;
} = {}): CollectionOnlyBrowserController & {
  launch: Mock<[], Promise<void>>;
  navigate: Mock<[string], Promise<void>>;
  close: Mock<[], Promise<void>>;
  setResidue(pageValue: ReturnType<typeof page> | null, contextValue: unknown | null): void;
} {
  let currentPage = options.page === undefined ? page() : options.page;
  let browserContext: unknown | null = {};
  const close = vi.fn(options.close ?? (async () => {
    currentPage = null;
    browserContext = null;
  }));
  return {
    launch: vi.fn(options.launch ?? (async () => undefined)),
    navigate: vi.fn(options.navigate ?? (async () => undefined)),
    close,
    getPage: () => currentPage,
    getContext: () => browserContext,
    setResidue(pageValue, contextValue) {
      currentPage = pageValue;
      browserContext = contextValue;
    },
  };
}

function scope(
  targetContext = context(),
): StoreCollectionTransitionCapabilityScope<'transition_execution'> {
  return {
    capabilityDomain: 'transition_execution',
    capabilityId: 'capability-one',
    cycleId: 'cycle-one',
    transitionId: 'transition-one',
    purpose: 'collection',
    fromAuthority: { activeStoreId: null, context: null },
    originAuthority: { activeStoreId: null, context: null },
    target: {
      storeId: targetContext.storeId,
      browserProfileId: targetContext.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
    },
    expectedFingerprint: 'a'.repeat(64),
  };
}

function visibleRuntimeIntents(): {
  initial: StoreCollectionVisibleRuntimeIntent;
  terminalCleanup: StoreCollectionVisibleRuntimeIntent;
} {
  const domainCapability = Object.freeze({});
  const initialCapability = Object.freeze({});
  const terminalCleanupCapability = Object.freeze({});
  return {
    initial: Object.freeze({
      domainCapability,
      initialCapability,
      terminalCleanupCapability,
      selectedCapability: initialCapability,
    }) as StoreCollectionVisibleRuntimeIntent,
    terminalCleanup: Object.freeze({
      domainCapability,
      initialCapability,
      terminalCleanupCapability,
      selectedCapability: terminalCleanupCapability,
    }) as StoreCollectionVisibleRuntimeIntent,
  };
}

interface Harness {
  adapter: StoreCollectionOrchestratorVisibleRuntimeAdapter;
  registry: VisibleBrowserRuntimeRegistry;
  leases: BrowserLeaseManager;
  controller: ReturnType<typeof controller>;
  input: StoreCollectionExecutionAutomationAuthority & {
    context: StoreContextEnvelope;
    expectedAuthority: {
      activeStoreId: StoreId;
      context: StoreContextEnvelope;
    };
    visibleRuntimeIntent: StoreCollectionVisibleRuntimeIntent;
  };
  intents: ReturnType<typeof visibleRuntimeIntents>;
  setAuthority(value: StoreContextEnvelope | null): void;
  factory: Mock<any[], ReturnType<typeof controller>>;
  inspectIdentity: Mock<any[], Promise<ProviderPageIdentityResult>>;
  saveMetadata: Mock<[StoreSessionMetadata], void>;
  metadataTransaction: Mock<any[], unknown>;
  persistedReady: StoreSessionMetadata[];
  liveCapabilities: WeakSet<object>;
  issuerValidator: Mock<any[], void>;
  setIssuerBlocked(blocked: boolean): void;
}

function harness(overrides: Partial<StoreCollectionVisibleRuntimeAdapterOptions> & {
  controller?: ReturnType<typeof controller>;
} = {}): Harness {
  const selected = context();
  let authority = {
    activeStoreId: selected.storeId,
    context: selected,
  } as { activeStoreId: StoreId | null; context: StoreContextEnvelope | null };
  const registry = overrides.registry ?? new VisibleBrowserRuntimeRegistry(() => 'runtime-one');
  const leases = overrides.browserLeases instanceof BrowserLeaseManager
    ? overrides.browserLeases
    : new BrowserLeaseManager(
      () => 10_000,
      () => 'lease-token-0001',
      5_000,
    );
  const browser = overrides.controller ?? controller();
  const factory = vi.fn(() => browser);
  const defaultInspectIdentity = vi.fn(async () => ({
    status: 'ready' as const,
    pageUrl: 'https://erp.lingxing.com/erp/home',
    title: 'Lingxing ERP',
    domObservations: [],
  }));
  const saveMetadata = vi.fn<[StoreSessionMetadata], void>();
  const persistedReady: StoreSessionMetadata[] = [];
  const defaultMetadataTransaction = vi.fn((
    work: (writer: { saveReady(metadata: StoreSessionMetadata): void }) => unknown,
  ) => {
    const staged: StoreSessionMetadata[] = [];
    const result = work({
      saveReady(metadata) {
        saveMetadata(metadata);
        staged.push(metadata);
      },
    });
    persistedReady.push(...staged);
    return result;
  });
  const liveCapabilities = new WeakSet<object>();
  const capability = Object.freeze({});
  const transitionCapability = Object.freeze({});
  liveCapabilities.add(capability);
  liveCapabilities.add(transitionCapability);
  let issuerBlocked = false;
  const defaultIssuerValidator = vi.fn((
    value: StoreCollectionExecutionAutomationAuthority,
  ) => {
    if (issuerBlocked) throw new Error('scheduler claim blocks new transition binding');
    if (!liveCapabilities.has(value.capability)
      || !liveCapabilities.has(value.transitionCapability)) {
      throw new Error('forged transition authority');
    }
  });
  const transitionScope = scope(selected);
  const intents = visibleRuntimeIntents();
  const options: StoreCollectionVisibleRuntimeAdapterOptions = {
    registry,
    browserLeases: leases,
    assertTransitionAuthority: defaultIssuerValidator,
    readCurrentAuthority: () => authority,
    listActiveStores: () => [store(selected)],
    listStoreConnections: () => [connection(selected)],
    resolveStoreCapsule: () => deriveStoreCapsulePaths(
      'D:\\trusted-capsules',
      selected.storeId,
      selected.browserProfileId,
    ),
    createHeadedBrowserController: factory,
    inspectLingxingIdentity: defaultInspectIdentity,
    withLingxingReadyMetadataTransaction:
      defaultMetadataTransaction as StoreCollectionVisibleRuntimeAdapterOptions[
        'withLingxingReadyMetadataTransaction'
      ],
    now: () => new Date('2026-07-30T12:34:56.000Z'),
    ...overrides,
  };
  delete (options as typeof options & { controller?: unknown }).controller;
  const inspectIdentity = options.inspectLingxingIdentity as Harness['inspectIdentity'];
  const metadataTransaction =
    options.withLingxingReadyMetadataTransaction as Harness['metadataTransaction'];
  const issuerValidator = options.assertTransitionAuthority as Harness['issuerValidator'];
  const adapter = new StoreCollectionOrchestratorVisibleRuntimeAdapter(options);
  return {
    adapter,
    registry,
    leases,
    controller: browser,
    input: {
      owner: 'daily-collector',
      capability: capability as StoreCollectionExecutionAutomationAuthority['capability'],
      transitionCapability:
        transitionCapability as StoreCollectionExecutionAutomationAuthority['transitionCapability'],
      transitionScope,
      context: selected,
      expectedAuthority: {
        activeStoreId: selected.storeId,
        context: selected,
      },
      visibleRuntimeIntent: intents.initial,
    },
    intents,
    setAuthority(value) {
      authority = {
        activeStoreId: value?.storeId ?? null,
        context: value,
      };
    },
    factory,
    inspectIdentity,
    saveMetadata,
    metadataTransaction,
    persistedReady,
    liveCapabilities,
    issuerValidator,
    setIssuerBlocked(blocked) {
      issuerBlocked = blocked;
    },
  };
}

async function prepareStart(test: Harness): Promise<void> {
  await test.adapter.closeVisibleRuntime(test.input);
  await test.adapter.assertCollectionLeaseReleased(test.input);
}

function terminalInput(test: Harness): Harness['input'] {
  return {
    ...test.input,
    visibleRuntimeIntent: test.intents.terminalCleanup,
  };
}

function nextRestoreInput(test: Harness, suffix: string): Harness['input'] {
  const transitionCapability = Object.freeze({});
  const intents = visibleRuntimeIntents();
  test.liveCapabilities.add(transitionCapability);
  return {
    ...test.input,
    transitionCapability:
      transitionCapability as StoreCollectionExecutionAutomationAuthority[
        'transitionCapability'
      ],
    transitionScope: {
      ...scope(test.input.context),
      capabilityId: `restore-capability-${suffix}`,
      transitionId: `restore-transition-${suffix}`,
      purpose: 'restore',
    },
    visibleRuntimeIntent: intents.initial,
  };
}

describe('StoreCollectionOrchestratorVisibleRuntimeAdapter', () => {
  it('opens only a headed Lingxing controller with the derived profile and no credential/Ads fields', async () => {
    const test = harness();
    await prepareStart(test);
    const result = await test.adapter.startCollectionOnlyVisibleRuntime(test.input);

    expect(result).toMatchObject({ started: true, authority: test.input.expectedAuthority });
    expect(result.capability).toBe(test.input.capability);
    expect(result.transitionCapability).toBe(test.input.transitionCapability);
    expect(result.transitionScope).toBe(test.input.transitionScope);
    expect(test.factory).toHaveBeenCalledWith({
      purpose: 'collection_only',
      provider: 'lingxing',
      context: test.input.context,
      userDataDir: expect.stringMatching(/[\\/]lingxing$/),
      headless: false,
    });
    const factoryInput = test.factory.mock.calls[0][0] as Record<string, unknown>;
    expect(factoryInput).not.toHaveProperty('password');
    expect(factoryInput).not.toHaveProperty('username');
    expect(factoryInput).not.toHaveProperty('amazonAdsProfileDir');
    expect(test.controller.launch).toHaveBeenCalledOnce();
    expect(test.controller.navigate).toHaveBeenCalledWith('https://erp.lingxing.com/');
    expect(test.registry.read()).toMatchObject({
      purpose: 'collection_only',
      providerIdentityStatus: {
        lingxing: 'pending',
        amazonAds: 'not_present',
      },
      context: test.input.context,
    });
  });

  it('verifies live identity before writing ready metadata and preserves original tokens', async () => {
    const order: string[] = [];
    const test = harness({
      inspectLingxingIdentity: vi.fn(async () => {
        order.push('identity');
        return {
          status: 'ready' as const,
          pageUrl: 'https://erp.lingxing.com/erp/home',
          title: 'ERP',
          domObservations: [],
        };
      }),
    });
    const originalTransaction = test.metadataTransaction.getMockImplementation()!;
    test.metadataTransaction.mockImplementation((work) => {
      order.push('metadata');
      return originalTransaction(work);
    });
    await prepareStart(test);
    await test.adapter.startCollectionOnlyVisibleRuntime(test.input);
    const result = await test.adapter.verifyVisibleLingxingIdentity(test.input);

    expect(order).toEqual(['identity', 'metadata']);
    expect(result.verified).toBe(true);
    expect(result.capability).toBe(test.input.capability);
    expect(result.transitionCapability).toBe(test.input.transitionCapability);
    expect(test.registry.read()?.providerIdentityStatus).toEqual({
      lingxing: 'verified',
      amazonAds: 'not_present',
    });
    expect(test.saveMetadata).toHaveBeenCalledOnce();
    expect(test.saveMetadata).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'lingxing',
      status: 'ready',
      storeId: test.input.context.storeId,
      browserProfileId: test.input.context.browserProfileId,
      sessionGeneration: test.input.context.sessionGeneration,
    }));
    const postVerifyLease = test.leases.acquire({
      storeId: test.input.context.storeId,
      owner: 'scheduler-after-identity',
      purpose: 'collection',
    });
    test.leases.release(postVerifyLease);
  });

  it('uses one issuer-backed binding, then permits only local exact cleanup after scheduler claim', async () => {
    const test = harness();
    await prepareStart(test);
    await test.adapter.startCollectionOnlyVisibleRuntime(test.input);
    await test.adapter.verifyVisibleLingxingIdentity(test.input);
    expect(test.issuerValidator).toHaveBeenCalledOnce();

    test.setIssuerBlocked(true);
    await expect(test.adapter.startCollectionOnlyVisibleRuntime(test.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    await expect(test.adapter.verifyVisibleLingxingIdentity(test.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.issuerValidator).toHaveBeenCalledOnce();

    const newCapability = Object.freeze({});
    const newTransitionCapability = Object.freeze({});
    const newIntents = visibleRuntimeIntents();
    test.liveCapabilities.add(newCapability);
    test.liveCapabilities.add(newTransitionCapability);
    const newInput = {
      ...test.input,
      capability:
        newCapability as StoreCollectionExecutionAutomationAuthority['capability'],
      transitionCapability:
        newTransitionCapability as StoreCollectionExecutionAutomationAuthority[
          'transitionCapability'
        ],
      transitionScope: {
        ...scope(test.input.context),
        capabilityId: 'capability-two',
        transitionId: 'transition-two',
      },
      visibleRuntimeIntent: newIntents.initial,
    };
    await expect(test.adapter.closeVisibleRuntime(newInput))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.issuerValidator).toHaveBeenCalledTimes(2);

    await expect(test.adapter.closeVisibleRuntime(terminalInput(test)))
      .resolves.toMatchObject({ closed: true });
    await expect(test.adapter.assertCollectionLeaseReleased(terminalInput(test)))
      .resolves.toMatchObject({ released: true });
    expect(test.issuerValidator).toHaveBeenCalledTimes(2);

    await expect(test.adapter.closeVisibleRuntime(terminalInput(test)))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    await expect(test.adapter.startCollectionOnlyVisibleRuntime(test.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    await expect(test.adapter.verifyVisibleLingxingIdentity(test.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
  });

  it('keeps the restore barrier across the first close/lease and retires only after terminal close/lease', async () => {
    const test = harness();
    const restoreInput = {
      ...test.input,
      transitionScope: {
        ...test.input.transitionScope,
        purpose: 'restore' as const,
      },
    };
    const restoreTerminalInput = {
      ...restoreInput,
      visibleRuntimeIntent: test.intents.terminalCleanup,
    };

    await expect(test.adapter.closeVisibleRuntime(restoreInput))
      .resolves.toMatchObject({ closed: true });
    await expect(test.adapter.assertCollectionLeaseReleased(restoreInput))
      .resolves.toMatchObject({ released: true });
    expect(() => test.leases.acquire({
      storeId: test.input.context.storeId,
      owner: 'blocked-between-restore-closes',
      purpose: 'external_write',
    })).toThrow(/transition barrier/);

    await expect(test.adapter.closeVisibleRuntime(restoreTerminalInput))
      .resolves.toMatchObject({ closed: true });
    await expect(test.adapter.assertCollectionLeaseReleased(restoreTerminalInput))
      .resolves.toMatchObject({ released: true });
    const releasedLease = test.leases.acquire({
      storeId: test.input.context.storeId,
      owner: 'after-restore-retired',
      purpose: 'external_write',
    });
    test.leases.release(releasedLease);
    await expect(test.adapter.closeVisibleRuntime(restoreTerminalInput))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.issuerValidator).toHaveBeenCalledOnce();
  });

  it.each([
    ['login_required', 'LOGIN_REQUIRED'],
    ['mfa_required', 'MFA_REQUIRED'],
    ['identity_unverified', 'IDENTITY_UNVERIFIED'],
  ] as const)('maps %s and strictly closes the failed candidate', async (status, code) => {
    const test = harness();
    test.inspectIdentity.mockResolvedValueOnce({
      status,
      pageUrl: 'https://erp.lingxing.com/',
      title: 'ERP',
      domObservations: [],
    });
    await prepareStart(test);
    await test.adapter.startCollectionOnlyVisibleRuntime(test.input);

    await expect(test.adapter.verifyVisibleLingxingIdentity(test.input))
      .rejects.toMatchObject({ code });
    expect(test.controller.close).toHaveBeenCalledOnce();
    expect(test.registry.read()).toBeNull();
    expect(test.saveMetadata).not.toHaveBeenCalled();
  });

  it('does not let historical ready metadata replace a live-page identity result', async () => {
    const selected = context();
    const historicalReady: StoreConnection = {
      ...connection(selected),
      session: {
        storeId: selected.storeId,
        browserProfileId: selected.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: selected.sessionGeneration,
        observedAt: '2026-07-30T00:00:00.000Z',
        verifiedAt: '2026-07-30T00:00:00.000Z',
      },
    };
    const test = harness({
      listStoreConnections: () => [historicalReady],
    });
    test.inspectIdentity.mockResolvedValueOnce({
      status: 'identity_unverified',
      pageUrl: 'https://erp.lingxing.com/erp/home',
      title: 'ERP',
      domObservations: [],
    });
    await prepareStart(test);
    await test.adapter.startCollectionOnlyVisibleRuntime(test.input);

    await expect(test.adapter.verifyVisibleLingxingIdentity(test.input))
      .rejects.toMatchObject({ code: 'IDENTITY_UNVERIFIED' });
    expect(test.saveMetadata).not.toHaveBeenCalled();
  });

  it('rejects a label-only connection before launch and never writes ready metadata', async () => {
    const selected = context();
    const {
      externalAccountId: _externalAccountId,
      ...labelOnlyConnection
    } = connection(selected);
    const test = harness({
      listStoreConnections: () => [labelOnlyConnection],
    });
    await prepareStart(test);

    await expect(test.adapter.startCollectionOnlyVisibleRuntime(test.input))
      .rejects.toMatchObject({ code: 'IDENTITY_UNVERIFIED' });
    expect(test.factory).not.toHaveBeenCalled();
    expect(test.inspectIdentity).not.toHaveBeenCalled();
    expect(test.saveMetadata).not.toHaveBeenCalled();
    expect(test.persistedReady).toEqual([]);
    expect(test.registry.read()).toBeNull();
  });

  it('fails closed and removes the candidate when authority drifts after launch', async () => {
    let releaseLaunch!: () => void;
    const launchGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const test = harness({
      controller: controller({
        launch: async () => launchGate,
      }),
    });
    await prepareStart(test);
    const start = test.adapter.startCollectionOnlyVisibleRuntime(test.input);
    await vi.waitFor(() => expect(test.controller.launch).toHaveBeenCalledOnce());
    test.setAuthority(context({ sessionGeneration: 9 }));
    releaseLaunch();

    await expect(start).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.registry.read()).toBeNull();
  });

  it('rolls back synchronous ready metadata when authority drifts inside the authority-bound transaction', async () => {
    const persisted: StoreSessionMetadata[] = [];
    let driftAuthority = () => undefined;
    const transaction = vi.fn((
      work: (writer: { saveReady(metadata: StoreSessionMetadata): void }) => unknown,
    ) => {
      const staged: StoreSessionMetadata[] = [];
      const result = work({
        saveReady(metadata) {
          staged.push(metadata);
          driftAuthority();
        },
      });
      persisted.push(...staged);
      return result;
    });
    const test = harness({
      withLingxingReadyMetadataTransaction:
        transaction as StoreCollectionVisibleRuntimeAdapterOptions[
          'withLingxingReadyMetadataTransaction'
        ],
    });
    driftAuthority = () => {
      test.setAuthority(context({ sessionGeneration: 9 }));
    };
    await prepareStart(test);
    await test.adapter.startCollectionOnlyVisibleRuntime(test.input);

    await expect(test.adapter.verifyVisibleLingxingIdentity(test.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.registry.read()).toBeNull();
    expect(persisted).toEqual([]);
  });

  it('rejects a Promise-returning ready metadata transaction and closes the candidate', async () => {
    const saveReady = vi.fn<[StoreSessionMetadata], void>();
    const test = harness({
      withLingxingReadyMetadataTransaction: ((
        work: (writer: { saveReady(metadata: StoreSessionMetadata): void }) => unknown,
      ) => Promise.resolve(work({ saveReady }))) as unknown as
        StoreCollectionVisibleRuntimeAdapterOptions[
          'withLingxingReadyMetadataTransaction'
        ],
    });
    await prepareStart(test);
    await test.adapter.startCollectionOnlyVisibleRuntime(test.input);

    await expect(test.adapter.verifyVisibleLingxingIdentity(test.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(saveReady).toHaveBeenCalledOnce();
    expect(test.registry.read()).toBeNull();
  });

  it('rejects forged tokens and scope mutation', async () => {
    const forgedIntent = harness();
    await expect(forgedIntent.adapter.closeVisibleRuntime({
      ...forgedIntent.input,
      visibleRuntimeIntent: {
        ...forgedIntent.intents.initial,
      } as StoreCollectionVisibleRuntimeIntent,
    })).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    await expect(forgedIntent.adapter.closeVisibleRuntime({
      ...forgedIntent.input,
      visibleRuntimeIntent: forgedIntent.intents.terminalCleanup,
    })).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(forgedIntent.issuerValidator).not.toHaveBeenCalled();

    const forged = harness();
    await prepareStart(forged);
    await expect(forged.adapter.startCollectionOnlyVisibleRuntime({
      ...forged.input,
      transitionCapability: Object.freeze(
        {},
      ) as StoreCollectionExecutionAutomationAuthority['transitionCapability'],
    })).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });

    const mutated = harness();
    await prepareStart(mutated);
    await mutated.adapter.startCollectionOnlyVisibleRuntime(mutated.input);
    (mutated.input.transitionScope as { cycleId: string }).cycleId = 'cycle-mutated';
    await expect(mutated.adapter.verifyVisibleLingxingIdentity(mutated.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
  });

  it.each([
    { storeId: 'store-two' as StoreId },
    { browserProfileId: 'profile-two' as BrowserProfileId },
    { businessDate: '2026-07-31' as StoreContextEnvelope['businessDate'] },
    { sessionGeneration: 9 },
  ])('rejects cross-scope context mutation $storeId$browserProfileId$businessDate$sessionGeneration', async (mutation) => {
    const test = harness();
    await prepareStart(test);
    const mutatedContext = context(mutation);
    await expect(test.adapter.startCollectionOnlyVisibleRuntime({
      ...test.input,
      context: mutatedContext,
      expectedAuthority: {
        activeStoreId: mutatedContext.storeId,
        context: mutatedContext,
      },
    })).rejects.toBeInstanceOf(StoreCollectionVisibleRuntimeAdapterError);
    expect(test.factory).not.toHaveBeenCalled();
  });

  it('blocks initial close while another store has an unreleased browser lease', async () => {
    let token = 0;
    const leases = new BrowserLeaseManager(
      () => 10_000,
      () => `lease-token-${String(++token).padStart(4, '0')}`,
      5_000,
    );
    leases.acquire({
      storeId: 'store-two' as StoreId,
      owner: 'other-store-writer',
      purpose: 'external_write',
    });
    const test = harness({ browserLeases: leases });

    await expect(test.adapter.closeVisibleRuntime(test.input))
      .rejects.toMatchObject({ code: 'COLLECTION_LEASE_ACTIVE' });
    await expect(test.adapter.assertCollectionLeaseReleased(test.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
  });

  it('retires a transition when initial operator close rejects and terminal cleanup retry succeeds', async () => {
    let closeAttempt = 0;
    let manualBrowser!: ReturnType<typeof controller>;
    manualBrowser = controller({
      close: async () => {
        closeAttempt += 1;
        if (closeAttempt === 1) throw new Error('transient operator close failure');
        manualBrowser.setResidue(null, null);
      },
    });
    const test = harness({ controller: manualBrowser });
    const amazonAdsBrowser = controller();
    test.registry.publishCandidate({
      purpose: 'operator_full',
      context: test.input.context,
      controllers: { lingxing: manualBrowser, amazonAds: amazonAdsBrowser },
      profileDirs: {
        lingxing: 'C:\\profiles\\manual-lingxing',
        amazonAds: 'C:\\profiles\\manual-amazon-ads',
      },
      connections: {
        lingxing: connection(test.input.context),
        amazonAds: amazonAdsConnection(test.input.context),
      },
      attempt: { kind: 'manual', attemptId: 'manual-transient', attemptEpoch: 1 },
    });

    await expect(test.adapter.closeVisibleRuntime(test.input))
      .rejects.toMatchObject({ code: 'RUNTIME_CLOSE_FAILED' });
    await expect(test.adapter.closeVisibleRuntime(terminalInput(test)))
      .resolves.toMatchObject({ closed: true });
    await expect(test.adapter.assertCollectionLeaseReleased(terminalInput(test)))
      .resolves.toMatchObject({ released: true });
    expect(manualBrowser.close).toHaveBeenCalledTimes(2);
    const afterCleanup = test.leases.acquire({
      storeId: test.input.context.storeId,
      owner: 'after-terminal-cleanup',
      purpose: 'collection',
    });
    test.leases.release(afterCleanup);

    const restore = nextRestoreInput(test, 'after-close-retry');
    await expect(test.adapter.closeVisibleRuntime(restore))
      .resolves.toMatchObject({ closed: true });
  });

  it('treats terminal cleanup as terminal after the initial close was blocked by an active lease', async () => {
    const test = harness();
    const blockingLease = test.leases.acquire({
      storeId: 'store-two' as StoreId,
      owner: 'transient-writer',
      purpose: 'external_write',
    });

    await expect(test.adapter.closeVisibleRuntime(test.input))
      .rejects.toMatchObject({ code: 'COLLECTION_LEASE_ACTIVE' });
    test.leases.release(blockingLease);
    await expect(test.adapter.closeVisibleRuntime(terminalInput(test)))
      .resolves.toMatchObject({ closed: true });
    await expect(test.adapter.assertCollectionLeaseReleased(terminalInput(test)))
      .resolves.toMatchObject({ released: true });

    const restore = nextRestoreInput(test, 'after-lease-retry');
    await expect(test.adapter.closeVisibleRuntime(restore))
      .resolves.toMatchObject({ closed: true });
  });

  it('enters the global barrier before awaiting manual operator runtime close', async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let manualBrowser!: ReturnType<typeof controller>;
    manualBrowser = controller({
      close: async () => {
        await closeGate;
        manualBrowser.setResidue(null, null);
      },
    });
    const test = harness({ controller: manualBrowser });
    const amazonAdsBrowser = controller();
    const manualClaim = test.registry.publishCandidate({
      purpose: 'operator_full',
      context: test.input.context,
      controllers: { lingxing: manualBrowser, amazonAds: amazonAdsBrowser },
      profileDirs: {
        lingxing: 'C:\\profiles\\manual-lingxing',
        amazonAds: 'C:\\profiles\\manual-amazon-ads',
      },
      connections: {
        lingxing: connection(test.input.context),
        amazonAds: amazonAdsConnection(test.input.context),
      },
      attempt: { kind: 'manual', attemptId: 'manual-login-one', attemptEpoch: 1 },
    });

    const closing = test.adapter.closeVisibleRuntime(test.input);
    await vi.waitFor(() => expect(manualBrowser.close).toHaveBeenCalledOnce());
    expect(() => test.leases.acquire({
      storeId: 'store-two' as StoreId,
      owner: 'racing-writer',
      purpose: 'external_write',
    })).toThrow(/transition barrier/);
    releaseClose();

    await expect(closing).resolves.toMatchObject({ closed: true });
    await expect(test.adapter.assertCollectionLeaseReleased(test.input))
      .resolves.toMatchObject({ released: true });
    expect(() => test.registry.assertClaimCurrent(manualClaim)).toThrow(/replayed/);
  });

  it('does not report closed when strict controller close rejects', async () => {
    const test = harness({
      controller: controller({
        close: async () => {
          throw new Error('cannot close');
        },
      }),
    });
    await prepareStart(test);
    await test.adapter.startCollectionOnlyVisibleRuntime(test.input);

    await expect(test.adapter.closeVisibleRuntime(terminalInput(test)))
      .rejects.toMatchObject({ code: 'RUNTIME_CLOSE_FAILED' });
    expect(test.registry.read()).not.toBeNull();
  });

  it('returns global empty confirmations without starting a browser', async () => {
    const test = harness();
    await expect(test.adapter.closeVisibleRuntime(test.input))
      .resolves.toMatchObject({ closed: true });
    await expect(test.adapter.assertCollectionLeaseReleased(test.input))
      .resolves.toMatchObject({ released: true });
    expect(test.factory).not.toHaveBeenCalled();
  });

  it('rejects a capsule bound to another Store/Profile before launch', async () => {
    const test = harness({
      resolveStoreCapsule: () => ({
        ...deriveStoreCapsulePaths('D:\\trusted-capsules', 'store-two', 'profile-two'),
        storeId: 'store-two' as StoreId,
        browserProfileId: 'profile-two' as BrowserProfileId,
      } as StoreCapsulePaths),
    });
    await prepareStart(test);
    await expect(test.adapter.startCollectionOnlyVisibleRuntime(test.input))
      .rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(test.factory).not.toHaveBeenCalled();
  });
});
