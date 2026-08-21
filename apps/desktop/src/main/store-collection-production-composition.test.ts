import {
  BrowserLeaseManager,
  deriveStoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  fingerprintCollectionResumeExecutionContext,
  fingerprintLingxingCollectionAuthorityProof,
  type CollectionInPlaceResumeState,
  type CollectionResumeAttemptReceipt,
  type LingxingCollectionAuthorityProof,
} from '@amazon-ai-ops/local-db';
import type {
  LingxingCollectionJobSnapshot,
  StoreContextEnvelope,
  StoreRecord,
  StoreRuntimeConfigRecord,
  StoreSessionMetadata,
} from '@amazon-ai-ops/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  StoreCollectionMainRuntimeError,
} from './store-collection-main-runtime';
import {
  StoreCollectionOrchestratorError,
  type StoreCollectionOrchestratorDependencies,
} from './store-collection-orchestrator';
import {
  StoreCollectionPolicySuppressionController,
} from './store-collection-policy-suppression';
import { StoreCoordinatorError } from './store-coordinator';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
} from './visible-browser-runtime-registry';
import {
  createStoreCollectionProductionComposition,
} from './store-collection-production-composition';
import type { LingxingCollectionCoordinatorResult } from './lingxing-collection-coordinator';

const CONTEXT: StoreContextEnvelope = Object.freeze({
  storeId: 'store-one' as StoreContextEnvelope['storeId'],
  browserProfileId: 'profile-one' as StoreContextEnvelope['browserProfileId'],
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22' as StoreContextEnvelope['businessDate'],
  sessionGeneration: 4,
});

const STORE: StoreRecord = Object.freeze({
  storeId: CONTEXT.storeId,
  browserProfileId: CONTEXT.browserProfileId,
  displayName: 'US Store One',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
});

const CONFIG: StoreRuntimeConfigRecord = Object.freeze({
  configId: 'config-one',
  storeId: CONTEXT.storeId,
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  status: 'active',
  revision: 1,
  values: Object.freeze({
    aiRecommendationsEnabled: true,
    collectionScheduleLocalTime: '07:30',
    collectionLookbackDays: 7,
    analysisWindowDays: 30,
    defaultTargetAcosPercent: 28,
    minimumRecommendationConfidencePercent: 80,
    evidenceRetentionDays: 90,
  }),
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
});

const FULL8_REPORT_TYPES = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
] as const;

function failedResumePacket(): CollectionInPlaceResumeState {
  const job: LingxingCollectionJobSnapshot = {
    jobId: 'job-resume-one',
    request: {
      requestId: 'request-resume-one',
      storeContext: CONTEXT,
      dateStart: '2026-07-15',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: FULL8_REPORT_TYPES,
    },
    lineage: {
      lineageId: 'job-resume-one',
      rootJobId: 'job-resume-one',
      expectedReportTypes: FULL8_REPORT_TYPES,
      purpose: 'production_full',
    },
    state: 'failed',
    reports: FULL8_REPORT_TYPES.map((reportType) => ({
      reportType,
      state: 'failed' as const,
      attemptIndex: 0,
      autoRetryCount: 0,
      errorCode: 'DOWNLOAD_FAILED',
      updatedAt: '2026-07-22T15:04:00.000Z',
    })),
    createdAt: '2026-07-22T15:00:00.000Z',
    updatedAt: '2026-07-22T15:05:00.000Z',
    completedAt: '2026-07-22T15:05:00.000Z',
    blockerCode: 'DOWNLOAD_FAILED',
    importState: 'not_applicable',
  };
  return {
    jobId: job.jobId,
    job,
    request: job.request,
    reports: job.reports.map((checkpoint) => ({
      ...checkpoint,
      state: 'queued' as const,
      errorCode: undefined,
    })),
    batch: {
      storeId: CONTEXT.storeId,
      id: job.jobId,
      requestId: job.request.requestId,
      browserProfileId: CONTEXT.browserProfileId,
      businessDate: CONTEXT.businessDate,
      sessionGeneration: CONTEXT.sessionGeneration,
      dateStart: job.request.dateStart,
      dateEnd: job.request.dateEnd,
      marketplaceCode: 'US' as const,
      status: 'failed' as const,
      downloadDir: 'D:\\trusted-store-capsules\\store-one\\downloads\\job-resume-one',
      createdAt: job.createdAt,
      completedAt: job.completedAt!,
    },
    files: [],
    expectedJobUpdatedAt: job.updatedAt,
    authorityProofSha256: 'a'.repeat(64),
  } as CollectionInPlaceResumeState;
}

function failedAuthorityProof(
  packet: CollectionInPlaceResumeState,
  job: LingxingCollectionJobSnapshot,
): LingxingCollectionAuthorityProof {
  return {
    job,
    jobRow: {
      storeId: CONTEXT.storeId,
      jobId: job.jobId,
      requestId: job.request.requestId,
      browserProfileId: CONTEXT.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: CONTEXT.businessDate,
      sessionGeneration: CONTEXT.sessionGeneration,
      dateStart: job.request.dateStart,
      dateEnd: job.request.dateEnd,
      mode: 'create-and-download',
      reportTypesJson: JSON.stringify(FULL8_REPORT_TYPES),
      state: job.state,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt ?? null,
      blockerCode: job.blockerCode ?? null,
      detail: job.detail ?? null,
    },
    checkpointCount: job.reports.length,
    batch: packet.batch,
    lingxingFileCount: packet.files.length,
    lingxingFiles: packet.files,
    importRunCount: 0,
    importRuns: [],
    importFileSnapshotCount: 0,
    importFileSnapshots: [],
    importedReportFileCount: 0,
    importedReportFiles: [],
    reconciliationRowCount: 0,
    reconciliations: [],
    metricEvidenceCount: 0,
    metricEvidence: [],
  };
}

function terminalResumeReceipt(
  packet: CollectionInPlaceResumeState,
  proof: LingxingCollectionAuthorityProof,
): CollectionResumeAttemptReceipt {
  return {
    storeId: CONTEXT.storeId,
    attemptId: 'resume-attempt-one',
    jobId: packet.jobId,
    requestId: packet.request.requestId,
    outcome: 'failed',
    baseJobUpdatedAt: packet.expectedJobUpdatedAt,
    finalJobUpdatedAt: proof.job.updatedAt,
    baseAuthorityProofSha256: packet.authorityProofSha256,
    finalAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(proof),
    durableSessionGeneration: packet.request.storeContext.sessionGeneration,
    executionSessionGeneration: CONTEXT.sessionGeneration,
    executionContextSha256: fingerprintCollectionResumeExecutionContext(CONTEXT),
    claimedAt: packet.expectedJobUpdatedAt,
    completedAt: '2026-07-22T15:07:00.000Z',
  };
}

function fixture(input: {
  packageUiReadOnly?: boolean;
  assertActiveStoreContext?: (value: unknown) => StoreContextEnvelope;
  onAuthoritySettled?: () => void | Promise<void>;
} = {}) {
  const registry = new VisibleBrowserRuntimeRegistry();
  const mutationLane = new StoreMutationLane();
  const policySuppression = new StoreCollectionPolicySuppressionController();
  const createHeadedBrowserController = vi.fn(() => ({
    launch: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    getPage: vi.fn(() => null),
    getContext: vi.fn(() => null),
  }));
  const lingxingStart = vi.fn(async () => {
    throw new Error('real Lingxing collection must not start in a composition test');
  });
  const lingxingResumeInPlace = vi.fn(async (
    _input: Readonly<{
      currentStoreContext: StoreContextEnvelope;
      resumeFrom: CollectionInPlaceResumeState;
    }>,
  ): Promise<LingxingCollectionCoordinatorResult> => {
    throw new Error('real Lingxing collection resume must not start in a composition test');
  });
  const readCurrentAuthority = vi.fn(() => ({
    activeStoreId: CONTEXT.storeId,
    context: CONTEXT,
  }));
  const timer = {
    set: vi.fn((_callback: () => void, _delayMs: number) => Object.freeze({})),
    clear: vi.fn(),
  };
  const onAuthoritySettled = vi.fn(
    input.onAuthoritySettled ?? (async () => undefined),
  );
  const reportError = vi.fn();
  const history = new Map<string, string>();
  const settings = {
    history: {
      get: vi.fn(() => history.get('collection-history') ?? null),
      set: vi.fn((value: string) => history.set('collection-history', value)),
      transaction<T>(work: () => T): T {
        return work();
      },
    },
    recordCodec: {
      isAvailable: vi.fn(() => true),
      seal: vi.fn((plaintext: string) => `sealed:${plaintext}`),
      open: vi.fn((envelope: string) => envelope.replace(/^sealed:/, '')),
    },
  };
  const importRepository = {
    getCollectionJobForStore: vi.fn(() => undefined),
    inspectUniqueCollectionJobForSemanticScope: vi.fn(() => undefined),
    readUniqueCollectionAuthorityProofForStoreByRequestId: vi.fn(
      (): LingxingCollectionAuthorityProof | undefined => undefined,
    ),
    getCollectionInPlaceResumeStateForStore: vi.fn(
      (_storeId: unknown, _jobId: unknown): CollectionInPlaceResumeState | undefined => undefined,
    ),
    readLatestCollectionResumeAttemptReceiptForStore: vi.fn(
      (): CollectionResumeAttemptReceipt | undefined => undefined,
    ),
    readUniqueSucceededCollectionResumeReceiptForStore: vi.fn(
      (): CollectionResumeAttemptReceipt | undefined => undefined,
    ),
    interruptOrphanedCollectionResumeClaimsForStartup: vi.fn(() => []),
  };
  const storeCoordinator = {
    listStores: vi.fn(() => [STORE]),
    getCollectionAuthority: vi.fn(() => ({
      activeStoreId: CONTEXT.storeId,
      context: CONTEXT,
    })),
    issueCollectionTransitionCapability: vi.fn(() => Object.freeze({}) as never),
    transitionForCollection: vi.fn(() => {
      throw new Error('authority transition is not expected in this composition test');
    }),
    assertActiveStoreContext: vi.fn(input.assertActiveStoreContext ?? (() => CONTEXT)),
    getActiveStoreContext: vi.fn(() => CONTEXT),
    listConnections: vi.fn(() => []),
  };
  const runtimeConfig = {
    get: vi.fn(() => ({ current: CONFIG, versions: [] })),
    getForStoreRecord: vi.fn(() => ({ current: CONFIG, versions: [] })),
    getForStoreId: vi.fn(() => ({ current: CONFIG, versions: [] })),
  };

  const options = {
    registry,
    mutationLane,
    policySuppression,
    storeCoordinator,
    runtimeConfig,
    lingxingCoordinator: { start: lingxingStart, resumeInPlace: lingxingResumeInPlace },
    importRepository,
    settings,
    browser: {
      leases: new BrowserLeaseManager(),
      resolveStoreCapsule: (context: StoreContextEnvelope) => deriveStoreCapsulePaths(
        'D:\\trusted-store-capsules',
        context.storeId,
        context.browserProfileId,
      ),
      createHeadedBrowserController,
    },
    sessionMetadata: {
      withLingxingReadyMetadataTransaction<Result>(
        work: (writer: { saveReady(metadata: StoreSessionMetadata): void }) => Result,
      ): Result {
        return work({ saveReady: vi.fn() });
      },
    },
    authorityReadback: { readCurrentAuthority },
    packageUiReadOnly: input.packageUiReadOnly,
    mainRuntime: {
      pollIntervalMs: 1_000,
      timer,
      reportError,
    },
    onAuthoritySettled,
    now: () => new Date('2026-07-22T15:00:00.000Z'),
    createCycleId: () => 'cycle-from-composition-test',
  };
  return {
    options,
    registry,
    mutationLane,
    policySuppression,
    createHeadedBrowserController,
    lingxingStart,
    lingxingResumeInPlace,
    importRepository,
    readCurrentAuthority,
    timer,
    storeCoordinator,
    onAuthoritySettled,
    reportError,
  };
}

async function readyComposition(testFixture = fixture()) {
  const composition = createStoreCollectionProductionComposition(testFixture.options);
  vi.spyOn(composition.orchestrator, 'recoverExistingTransitionsOnly').mockResolvedValue({
    cycleId: 'recovery-cycle',
    state: 'completed',
    outcomes: [],
    skippedStoreIds: [],
    plannedDueStoreIds: [],
    attemptedStoreIds: [],
  });
  await composition.runtime.recoverStartupThenConfirm();
  return { composition, testFixture };
}

function dependenciesOf(
  composition: ReturnType<typeof createStoreCollectionProductionComposition>,
): StoreCollectionOrchestratorDependencies {
  return Reflect.get(
    composition.orchestrator,
    'dependencies',
  ) as StoreCollectionOrchestratorDependencies;
}

function transitionReadInput() {
  const transitionScope = Object.freeze({
    capabilityDomain: 'transition_execution' as const,
    capabilityId: 'transition-capability-one',
    cycleId: 'cycle-one',
    transitionId: 'transition-one',
    purpose: 'collection' as const,
    fromAuthority: { activeStoreId: CONTEXT.storeId, context: CONTEXT },
    originAuthority: { activeStoreId: CONTEXT.storeId, context: CONTEXT },
    target: {
      storeId: CONTEXT.storeId,
      browserProfileId: CONTEXT.browserProfileId,
      marketplace: 'US' as const,
      currency: 'USD' as const,
      businessTimezone: 'America/Los_Angeles' as const,
    },
    expectedFingerprint: 'a'.repeat(64),
  });
  const transitionCapability = Object.freeze({});
  return {
    owner: 'test-owner',
    capability: Object.freeze({}),
    transitionCapability,
    transitionScope,
    expectedAuthority: { activeStoreId: CONTEXT.storeId, context: CONTEXT },
  } as unknown as Parameters<StoreCollectionOrchestratorDependencies['readTransitionAuthority']>[0];
}

describe('createStoreCollectionProductionComposition', () => {
  it('interrupts orphan resume claims before startup recovery without calling resume/browser work', async () => {
    const testFixture = fixture();
    const events: string[] = [];
    testFixture.importRepository.interruptOrphanedCollectionResumeClaimsForStartup
      .mockImplementation(() => {
        events.push('interrupt-orphan-claims');
        return [];
      });
    const composition = createStoreCollectionProductionComposition(testFixture.options);
    vi.spyOn(composition.orchestrator, 'recoverExistingTransitionsOnly').mockImplementation(async () => {
      events.push('orchestrator-recovery');
      return {
        cycleId: 'recovery-cycle',
        state: 'completed',
        outcomes: [],
        skippedStoreIds: [],
        plannedDueStoreIds: [],
        attemptedStoreIds: [],
      };
    });

    await composition.runtime.recoverStartupThenConfirm();

    expect(events).toEqual(['interrupt-orphan-claims', 'orchestrator-recovery']);
    expect(testFixture.lingxingResumeInPlace).not.toHaveBeenCalled();
    expect(testFixture.lingxingStart).not.toHaveBeenCalled();
    expect(testFixture.createHeadedBrowserController).not.toHaveBeenCalled();
  });

  it('injects exact repo state and coordinator callback into explicit MainRuntime resume', async () => {
    const { composition, testFixture } = await readyComposition();
    const packet = failedResumePacket();
    const terminalJob = {
      ...packet.job,
      updatedAt: '2026-07-22T15:06:00.000Z',
      completedAt: '2026-07-22T15:06:00.000Z',
    };
    const proof = failedAuthorityProof(packet, terminalJob);
    const receipt = terminalResumeReceipt(packet, proof);
    testFixture.importRepository.getCollectionInPlaceResumeStateForStore.mockReturnValue(packet);
    testFixture.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId
      .mockReturnValue(proof);
    testFixture.importRepository.readLatestCollectionResumeAttemptReceiptForStore
      .mockReturnValueOnce(undefined)
      .mockReturnValue(receipt);
    testFixture.lingxingResumeInPlace.mockResolvedValue({
      result: { job: terminalJob, batch: packet.batch, files: packet.files },
    });

    await expect(composition.runtime.resumeExisting({
      context: CONTEXT,
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      dateStart: packet.request.dateStart,
      dateEnd: packet.request.dateEnd,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
    })).resolves.toMatchObject({ state: 'completed', outcome: 'failed' });

    expect(testFixture.importRepository.getCollectionInPlaceResumeStateForStore)
      .toHaveBeenCalledWith(CONTEXT.storeId, packet.jobId);
    expect(testFixture.lingxingResumeInPlace).toHaveBeenCalledWith({
      currentStoreContext: CONTEXT,
      resumeFrom: packet,
    });
    expect(testFixture.lingxingStart).not.toHaveBeenCalled();
  });

  it('injects an exact completed-with-errors full-eight packet into explicit MainRuntime resume', async () => {
    const { composition, testFixture } = await readyComposition();
    const packet = failedResumePacket();
    packet.job.state = 'completed_with_errors';
    packet.batch.status = 'completed_with_errors';
    const terminalJob = {
      ...packet.job,
      state: 'completed_with_errors' as const,
      updatedAt: '2026-07-22T15:06:00.000Z',
      completedAt: '2026-07-22T15:06:00.000Z',
    };
    const proof = failedAuthorityProof(packet, terminalJob);
    const receipt = terminalResumeReceipt(packet, proof);
    testFixture.importRepository.getCollectionInPlaceResumeStateForStore.mockReturnValue(packet);
    testFixture.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId
      .mockReturnValue(proof);
    testFixture.importRepository.readLatestCollectionResumeAttemptReceiptForStore
      .mockReturnValueOnce(undefined)
      .mockReturnValue(receipt);
    testFixture.lingxingResumeInPlace.mockResolvedValue({
      result: { job: terminalJob, batch: packet.batch, files: packet.files },
    });

    await expect(composition.runtime.resumeExisting({
      context: CONTEXT,
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      dateStart: packet.request.dateStart,
      dateEnd: packet.request.dateEnd,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
    })).resolves.toMatchObject({ state: 'completed', outcome: 'failed' });

    expect(testFixture.lingxingResumeInPlace).toHaveBeenCalledWith({
      currentStoreContext: CONTEXT,
      resumeFrom: packet,
    });
    expect(testFixture.lingxingStart).not.toHaveBeenCalled();
  });

  it('fails inside the Main lane when a coordinator result lacks a new exact terminal receipt', async () => {
    const { composition, testFixture } = await readyComposition();
    const packet = failedResumePacket();
    const terminalJob = {
      ...packet.job,
      updatedAt: '2026-07-22T15:06:00.000Z',
      completedAt: '2026-07-22T15:06:00.000Z',
    };
    const proof = failedAuthorityProof(packet, terminalJob);
    testFixture.importRepository.getCollectionInPlaceResumeStateForStore.mockReturnValue(packet);
    testFixture.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId
      .mockReturnValue(proof);
    testFixture.lingxingResumeInPlace.mockResolvedValue({
      result: { job: terminalJob, batch: packet.batch, files: packet.files },
    });

    await expect(composition.runtime.resumeExisting({
      context: CONTEXT,
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      dateStart: packet.request.dateStart,
      dateEnd: packet.request.dateEnd,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
    })).rejects.toThrow(/terminal receipt/i);
    expect(composition.runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      mutationLane: { held: true, stickyUnknown: true },
    });
  });

  it('keeps the lane sticky when the coordinator rejects despite an exact durable receipt', async () => {
    const { composition, testFixture } = await readyComposition();
    const packet = failedResumePacket();
    const terminalJob = {
      ...packet.job,
      updatedAt: '2026-07-22T15:06:00.000Z',
      completedAt: '2026-07-22T15:06:00.000Z',
    };
    const proof = failedAuthorityProof(packet, terminalJob);
    const receipt = terminalResumeReceipt(packet, proof);
    testFixture.importRepository.getCollectionInPlaceResumeStateForStore.mockReturnValue(packet);
    testFixture.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId
      .mockReturnValue(proof);
    testFixture.importRepository.readLatestCollectionResumeAttemptReceiptForStore
      .mockReturnValueOnce(undefined)
      .mockReturnValue(receipt);
    testFixture.lingxingResumeInPlace.mockRejectedValue(new Error('IMPORT_FAILED_AFTER_FINALIZE'));

    await expect(composition.runtime.resumeExisting({
      context: CONTEXT,
      jobId: packet.jobId,
      requestId: packet.request.requestId,
      dateStart: packet.request.dateStart,
      dateEnd: packet.request.dateEnd,
      expectedJobUpdatedAt: packet.expectedJobUpdatedAt,
      expectedAuthorityProofSha256: packet.authorityProofSha256,
    })).rejects.toThrow('IMPORT_FAILED_AFTER_FINALIZE');
    expect(composition.runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      mutationLane: { held: true, stickyUnknown: true },
    });
  });

  it('reuses the three external singleton ports and stays browser/network inert while composing', () => {
    const testFixture = fixture({ packageUiReadOnly: true });

    const composition = createStoreCollectionProductionComposition(testFixture.options);

    expect(Object.keys(composition).sort()).toEqual([
      'mutationLane',
      'orchestrator',
      'policySuppression',
      'registry',
      'runtime',
      'schedulerReadModel',
    ]);
    expect(composition.registry).toBe(testFixture.registry);
    expect(composition.mutationLane).toBe(testFixture.mutationLane);
    expect(composition.policySuppression).toBe(testFixture.policySuppression);
    expect(composition.runtime.readStatus().packageUiReadOnly).toBe(true);
    expect(testFixture.createHeadedBrowserController).not.toHaveBeenCalled();
    expect(testFixture.lingxingStart).not.toHaveBeenCalled();
    expect(testFixture.readCurrentAuthority).not.toHaveBeenCalled();
    expect(testFixture.timer.set).not.toHaveBeenCalled();
    expect(testFixture.storeCoordinator.listStores).not.toHaveBeenCalled();
    expect(testFixture.onAuthoritySettled).not.toHaveBeenCalled();
  });

  it('routes Main scheduled and manual execution to runCycle and runStoreNow respectively', async () => {
    const { composition, testFixture } = await readyComposition();
    const scheduled = vi.spyOn(composition.orchestrator, 'runCycle').mockResolvedValue({
      cycleId: 'scheduled-cycle',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: [],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });
    const manual = vi.spyOn(composition.orchestrator, 'runStoreNow').mockResolvedValue({
      cycleId: 'manual-cycle',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: [],
      plannedDueStoreIds: [CONTEXT.storeId],
      attemptedStoreIds: [CONTEXT.storeId],
    });

    composition.runtime.start();
    await vi.waitFor(() => expect(scheduled).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(composition.mutationLane.inspect().held).toBe(false));
    await composition.runtime.runNow(CONTEXT);

    expect(testFixture.timer.set).toHaveBeenCalledOnce();
    expect(manual).toHaveBeenCalledOnce();
    expect(manual).toHaveBeenCalledWith(CONTEXT);
    expect(testFixture.onAuthoritySettled).toHaveBeenCalledTimes(3);
    expect(testFixture.lingxingStart).not.toHaveBeenCalled();
    expect(testFixture.createHeadedBrowserController).not.toHaveBeenCalled();
  });

  it('binds automation lease retirement and policy suppression to the exact issued capability', async () => {
    const testFixture = fixture();
    const composition = createStoreCollectionProductionComposition(testFixture.options);
    const dependencies = dependenciesOf(composition);

    const lease = await dependencies.acquireAutomationLease();
    const policyLease = await dependencies.acquirePolicyDispatchSuppression(lease);
    const policyReadback = await dependencies.readPolicyDispatchSuppression({
      ...lease,
      guard: policyLease.guard,
    });

    expect(policyLease.capability).toBe(lease.capability);
    expect(policyReadback.capability).toBe(lease.capability);
    expect(policyReadback.guard).toBe(policyLease.guard);
    await expect(policyLease.release()).resolves.toMatchObject({
      capability: lease.capability,
      guard: policyLease.guard,
      released: true,
    });
    await expect(lease.release()).resolves.toMatchObject({
      capability: lease.capability,
      released: true,
    });
    await expect(dependencies.readActiveAuthority(lease)).rejects.toThrow(
      'forged, retired, or owner-mismatched',
    );
    await expect(lease.release()).rejects.toThrow('release was replayed');
    expect(testFixture.lingxingStart).not.toHaveBeenCalled();
    expect(testFixture.createHeadedBrowserController).not.toHaveBeenCalled();
  });

  it('double-reads exact transition authority and echoes capability identities unchanged', async () => {
    const testFixture = fixture();
    const composition = createStoreCollectionProductionComposition(testFixture.options);
    const dependencies = dependenciesOf(composition);
    const input = transitionReadInput();

    const confirmation = await dependencies.readTransitionAuthority(input);

    expect(testFixture.readCurrentAuthority).toHaveBeenCalledTimes(2);
    expect(confirmation.capability).toBe(input.capability);
    expect(confirmation.transitionCapability).toBe(input.transitionCapability);
    expect(confirmation.transitionScope).toBe(input.transitionScope);
    expect(confirmation.authority).toEqual(input.expectedAuthority);
  });

  it('fails the transition authority CAS when either Main read drifts', async () => {
    const testFixture = fixture();
    testFixture.readCurrentAuthority
      .mockReturnValueOnce({ activeStoreId: CONTEXT.storeId, context: CONTEXT })
      .mockReturnValueOnce({
        activeStoreId: CONTEXT.storeId,
        context: { ...CONTEXT, sessionGeneration: CONTEXT.sessionGeneration + 1 },
      });
    const composition = createStoreCollectionProductionComposition(testFixture.options);
    const dependencies = dependenciesOf(composition);

    await expect(dependencies.readTransitionAuthority(transitionReadInput())).rejects.toThrow(
      'changed during exact double readback',
    );
    expect(testFixture.readCurrentAuthority).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      new StoreCollectionOrchestratorError('USER_OPERATION_BLOCKED', 'busy'),
      'MANUAL_COLLECTION_NOT_ADMITTED',
    ],
    [
      new StoreCoordinatorError('STORE_NOT_ACTIVE', 'inactive'),
      'STORE_NOT_ACTIVE',
    ],
    [
      new StoreCoordinatorError('STALE_STORE_CONTEXT', 'generation drift'),
      'SESSION_GENERATION_MISMATCH',
    ],
  ] as const)(
    'binds trusted orchestrator rejection %s to exact admission reason %s',
    async (admissionError, expectedReason) => {
      const testFixture = fixture();
      const { composition } = await readyComposition(testFixture);
      const manual = vi.spyOn(composition.orchestrator, 'runStoreNow')
        .mockRejectedValueOnce(admissionError);
      testFixture.onAuthoritySettled.mockClear();

      await expect(composition.runtime.runNow(CONTEXT)).rejects.toMatchObject({
        code: 'MANUAL_CYCLE_PREMUTATION_REJECTED',
        message: expect.stringContaining(expectedReason),
      });
      expect(manual).toHaveBeenCalledOnce();
      expect(testFixture.onAuthoritySettled).toHaveBeenCalledOnce();
      expect(testFixture.lingxingStart).not.toHaveBeenCalled();
      expect(testFixture.createHeadedBrowserController).not.toHaveBeenCalled();
    },
  );

  it('rethrows ordinary and structurally forged errors without converting them to admission receipts', async () => {
    const { composition, testFixture } = await readyComposition();
    const impostor = Object.assign(new Error('busy'), { code: 'USER_OPERATION_BLOCKED' });
    vi.spyOn(composition.orchestrator, 'runStoreNow').mockRejectedValueOnce(impostor);
    testFixture.onAuthoritySettled.mockClear();

    await expect(composition.runtime.runNow(CONTEXT)).rejects.toBe(impostor);
    expect(testFixture.onAuthoritySettled).toHaveBeenCalledOnce();
  });

  it('reports settled-notification failures without changing success or failure results', async () => {
    const notificationError = new Error('authority publish failed');
    const testFixture = fixture({
      onAuthoritySettled: async () => {
        throw notificationError;
      },
    });
    const { composition } = await readyComposition(testFixture);
    const manual = vi.spyOn(composition.orchestrator, 'runStoreNow');
    testFixture.onAuthoritySettled.mockClear();
    testFixture.reportError.mockClear();
    manual.mockResolvedValueOnce({
      cycleId: 'manual-success',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: [],
      plannedDueStoreIds: [CONTEXT.storeId],
      attemptedStoreIds: [CONTEXT.storeId],
    });

    await expect(composition.runtime.runNow(CONTEXT)).resolves.toMatchObject({
      cycleId: 'manual-success',
      state: 'completed',
    });
    expect(testFixture.onAuthoritySettled).toHaveBeenCalledOnce();
    expect(testFixture.reportError).toHaveBeenCalledOnce();
    expect(testFixture.reportError).toHaveBeenCalledWith(notificationError);

    const originalFailure = new Error('original orchestrator failure');
    testFixture.onAuthoritySettled.mockClear();
    testFixture.reportError.mockClear();
    manual.mockRejectedValueOnce(originalFailure);
    await expect(composition.runtime.runNow(CONTEXT)).rejects.toBe(originalFailure);
    expect(testFixture.onAuthoritySettled).toHaveBeenCalledOnce();
    expect(testFixture.reportError).toHaveBeenCalledWith(notificationError);
  });

  it('keeps package UI read-only enforcement inside MainRuntime', async () => {
    const testFixture = fixture({ packageUiReadOnly: true });
    const composition = createStoreCollectionProductionComposition(testFixture.options);
    const manual = vi.spyOn(composition.orchestrator, 'runStoreNow');

    await expect(composition.schedulerReadModel.runNow(CONTEXT)).rejects.toEqual(
      expect.objectContaining<Partial<StoreCollectionMainRuntimeError>>({
        code: 'PACKAGE_UI_READ_ONLY',
      }),
    );
    expect(manual).not.toHaveBeenCalled();
    expect(testFixture.storeCoordinator.assertActiveStoreContext).toHaveBeenCalledOnce();
    expect(testFixture.lingxingStart).not.toHaveBeenCalled();
    expect(testFixture.createHeadedBrowserController).not.toHaveBeenCalled();
  });
});
