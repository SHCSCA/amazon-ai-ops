import { describe, expect, it, vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type BrowserProfileId,
  type LingxingCollectionJobSnapshot,
  type LingxingReportType,
  type StoreConnection,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
  type StoreRuntimeConfigProjection,
  type StoreSessionMetadata,
} from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingCollectionAuthorityProof } from '@amazon-ai-ops/local-db';
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
  type StoreCollectionAutomationAuthority,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionTransitionCapabilityScope,
} from './store-collection-orchestrator';
import { StoreCollectionOrchestratorDomainAdapter } from './store-collection-orchestrator-domain-adapter';
import { StoreCollectionOrchestratorSchedulerAdapter } from './store-collection-orchestrator-scheduler-adapter';
import {
  deriveStoreCollectionWindow,
  storeCollectionScheduleSemanticFingerprint,
} from './store-collection-scheduler';
import {
  StoreCoordinator,
  type StoreAuthorityRepository,
  type StoreSessionGenerationAuthority,
} from './store-coordinator';

const REPORT_TYPES = LINGXING_AD_REPORTS.map((report) => report.type);
const NOW = new Date('2026-07-23T16:00:00.000Z');

class MemoryStoreRepository implements StoreAuthorityRepository {
  readonly stores = new Map<StoreId, StoreRecord>();
  transaction<T>(work: () => T): T { return work(); }
  listStores(): StoreRecord[] { return [...this.stores.values()]; }
  getStore(storeId: StoreId): StoreRecord | undefined { return this.stores.get(storeId); }
  createStore(): StoreRecord { throw new Error('unused'); }
  updateStore(): StoreRecord { throw new Error('unused'); }
  archiveStore(): StoreRecord { throw new Error('unused'); }
  restoreStore(): StoreRecord { throw new Error('unused'); }
  createConnection(): StoreConnection { throw new Error('unused'); }
  updateConnection(): StoreConnection { throw new Error('unused'); }
  removeConnection(): void { throw new Error('unused'); }
  listConnections(): StoreConnection[] { return []; }
  listSessionMetadata(): StoreSessionMetadata[] { return []; }
}

class MemorySessions implements StoreSessionGenerationAuthority {
  readonly generations = new Map<StoreId, number>();
  current(storeId: StoreId): number { return this.generations.get(storeId) ?? 0; }
  advance(storeId: StoreId): number {
    const next = this.current(storeId) + 1;
    this.generations.set(storeId, next);
    return next;
  }
  advanceMany(storeIds: readonly StoreId[]): ReadonlyMap<StoreId, number> {
    return new Map([...new Set(storeIds)].map((storeId) => [storeId, this.advance(storeId)]));
  }
  assertCurrent(context: { storeId: StoreId; sessionGeneration: number }): void {
    if (this.current(context.storeId) !== context.sessionGeneration) throw new Error('stale generation');
  }
}

class MemoryJobs {
  readonly rows: LingxingCollectionJobSnapshot[] = [];
  mutateProof?: (proof: LingxingCollectionAuthorityProof) => LingxingCollectionAuthorityProof;
  readUniqueCollectionAuthorityProofForStoreByRequestId(
    storeId: StoreId,
    requestId: string,
  ): LingxingCollectionAuthorityProof | undefined {
    const rows = this.rows.filter((job) => (
      job.request.storeContext.storeId === storeId
      && job.request.requestId === requestId
    ));
    if (rows.length > 1) throw new Error('duplicate durable request ambiguity');
    if (!rows[0]) return undefined;
    const proof = authorityProofForJob(structuredClone(rows[0]));
    return this.mutateProof ? this.mutateProof(proof) : proof;
  }
}

function store(storeId: string, profileId: string): StoreRecord {
  return {
    storeId: storeId as StoreId,
    browserProfileId: profileId as BrowserProfileId,
    displayName: storeId,
    marketplace: 'US',
    currency: 'USD',
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function config(storeId: StoreId, lookbackDays = 7): StoreRuntimeConfigProjection {
  return {
    current: {
      configId: `config-${storeId}`,
      storeId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      status: 'active',
      revision: 1,
      values: {
        aiRecommendationsEnabled: true,
        collectionScheduleLocalTime: '08:00',
        collectionLookbackDays: lookbackDays,
        analysisWindowDays: 30,
        defaultTargetAcosPercent: 28,
        minimumRecommendationConfidencePercent: 75,
        evidenceRetentionDays: 90,
      },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    versions: [],
  };
}

function completeJob(
  input: {
    requestId: string;
    storeContext: StoreContextEnvelope;
    dateStart: string;
    dateEnd: string;
    mode: 'create-and-download' | 'download-existing';
    reportTypes?: readonly LingxingReportType[];
  },
  overrides: Partial<LingxingCollectionJobSnapshot> = {},
): LingxingCollectionJobSnapshot {
  const timestamp = '2026-07-23T16:05:00.000Z';
  const reportTypes = [...(input.reportTypes ?? REPORT_TYPES)];
  const jobId = overrides.jobId ?? 'job-orchestrated-full8';
  return {
    jobId,
    request: {
      requestId: input.requestId,
      storeContext: input.storeContext,
      dateStart: input.dateStart,
      dateEnd: input.dateEnd,
      mode: input.mode,
      reportTypes,
    },
    lineage: {
      lineageId: jobId,
      rootJobId: jobId,
      expectedReportTypes: REPORT_TYPES,
      purpose: 'production_full',
    },
    state: 'completed',
    reports: REPORT_TYPES.map((reportType) => ({
      reportType,
      state: 'downloaded' as const,
      attemptIndex: 0,
      autoRetryCount: 0,
      createdReportIdentity: {
        provider: 'lingxing' as const,
        reportType,
        externalReportName: `report-${reportType}`,
        dateStart: input.dateStart,
        dateEnd: input.dateEnd,
        createdAt: timestamp,
      },
      fileSizeBytes: 1024,
      updatedAt: timestamp,
    })),
    createdAt: '2026-07-23T16:00:00.000Z',
    updatedAt: timestamp,
    completedAt: timestamp,
    importState: 'succeeded',
    importAttemptedAt: '2026-07-23T16:04:00.000Z',
    importCompletedAt: timestamp,
    ...overrides,
  };
}

function authorityProofForJob(
  job: LingxingCollectionJobSnapshot,
): LingxingCollectionAuthorityProof {
  const context = normalizeStoreContextEnvelope(job.request.storeContext);
  const terminal = job.state === 'completed'
    || job.state === 'completed_with_errors'
    || job.state === 'failed'
    || job.state === 'cancelled'
    || job.state === 'stale_authority';
  const batchStatus = job.state === 'completed'
    ? 'completed'
    : job.state === 'completed_with_errors'
      ? 'completed_with_errors'
      : 'failed';
  const batch = terminal ? {
    id: job.jobId,
    requestId: job.request.requestId,
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    dateStart: job.request.dateStart,
    dateEnd: job.request.dateEnd,
    marketplaceCode: 'US',
    status: batchStatus,
    downloadDir: `C:\\reports\\${job.jobId}`,
    createdAt: job.createdAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
  } as const : undefined;
  const downloaded = terminal
    ? job.reports.filter((checkpoint) => checkpoint.state === 'downloaded')
    : [];
  const lingxingFiles = downloaded.map((checkpoint, index) => ({
    storeId: context.storeId,
    id: `lingxing-${checkpoint.reportType}`,
    batchId: job.jobId,
    reportType: checkpoint.reportType,
    displayName: `${checkpoint.reportType}.xlsx`,
    status: 'downloaded' as const,
    filePath: `C:\\reports\\${job.jobId}\\${checkpoint.reportType}.xlsx`,
    fileSizeBytes: checkpoint.fileSizeBytes ?? 1024,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }));
  const succeeded = job.state === 'completed' && job.importState === 'succeeded';
  const run = succeeded ? {
    storeId: context.storeId,
    runId: `run-${job.jobId}`,
    idempotencyKey: `import-${job.jobId}`,
    inputFingerprint: 'a'.repeat(64),
    batchId: job.jobId,
    status: 'completed' as const,
    sourceFileCount: REPORT_TYPES.length,
    metricRowCount: 80,
    reconciliationCount: REPORT_TYPES.length,
    startedAt: job.importAttemptedAt ?? job.updatedAt,
    completedAt: job.importCompletedAt ?? job.updatedAt,
    createdAt: job.importAttemptedAt ?? job.updatedAt,
  } : undefined;
  const importedReportFiles = succeeded ? lingxingFiles.map((file, index) => ({
    id: index + 1,
    storeId: context.storeId,
    batchId: job.jobId,
    reportType: file.reportType,
    filePath: file.filePath!,
    fileName: file.displayName,
    fileSizeBytes: file.fileSizeBytes!,
    status: 'imported',
    importedRows: 10,
    fileHash: `${(index + 1).toString(16)}`.repeat(64).slice(0, 64),
    lastImportedAt: run!.completedAt,
  })) : [];
  const importFileSnapshots = succeeded ? lingxingFiles.map((file, index) => ({
    storeId: context.storeId,
    snapshotId: `snapshot-${file.reportType}`,
    runId: run!.runId,
    batchId: job.jobId,
    lingxingFileId: file.id,
    reportFileId: importedReportFiles[index]!.id,
    reportType: file.reportType,
    filePath: file.filePath!,
    fileName: file.displayName,
    fileSizeBytes: file.fileSizeBytes!,
    fileHash: importedReportFiles[index]!.fileHash!,
    importedRows: importedReportFiles[index]!.importedRows,
    capturedAt: run!.completedAt,
  })) : [];
  return {
    job,
    jobRow: {
      storeId: context.storeId,
      jobId: job.jobId,
      requestId: job.request.requestId,
      browserProfileId: context.browserProfileId,
      marketplace: context.marketplace,
      currency: context.currency,
      businessTimezone: context.businessTimezone,
      businessDate: context.businessDate,
      sessionGeneration: context.sessionGeneration,
      dateStart: job.request.dateStart,
      dateEnd: job.request.dateEnd,
      mode: job.request.mode,
      reportTypesJson: JSON.stringify(job.request.reportTypes),
      state: job.state,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt ?? null,
      blockerCode: job.blockerCode ?? null,
      detail: job.detail ?? null,
    },
    checkpointCount: job.reports.length,
    ...(batch ? { batch } : {}),
    lingxingFileCount: lingxingFiles.length,
    lingxingFiles,
    importRunCount: run ? 1 : 0,
    importRuns: run ? [run] : [],
    importFileSnapshotCount: importFileSnapshots.length,
    importFileSnapshots,
    importedReportFileCount: importedReportFiles.length,
    importedReportFiles,
  };
}

function nonterminalBatchForProof(
  proof: LingxingCollectionAuthorityProof,
  status: 'pending' | 'running',
  completedAt?: string,
): NonNullable<LingxingCollectionAuthorityProof['batch']> {
  const context = normalizeStoreContextEnvelope(proof.job.request.storeContext);
  return {
    id: proof.job.jobId,
    requestId: proof.job.request.requestId,
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    dateStart: proof.job.request.dateStart,
    dateEnd: proof.job.request.dateEnd,
    marketplaceCode: 'US',
    status,
    downloadDir: `C:\\reports\\${proof.job.jobId}`,
    createdAt: proof.job.createdAt,
    ...(completedAt ? { completedAt } : {}),
  };
}

function queuedJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
  const queued = {
    ...job,
    state: 'queued' as const,
    reports: job.reports.map((checkpoint) => ({ ...checkpoint, state: 'queued' as const })),
  };
  delete queued.completedAt;
  delete queued.importState;
  delete queued.importAttemptedAt;
  delete queued.importCompletedAt;
  delete queued.importError;
  return queued;
}

function runningJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
  const running = { ...job, state: 'running' as const };
  delete running.completedAt;
  delete running.importState;
  delete running.importAttemptedAt;
  delete running.importCompletedAt;
  delete running.importError;
  return running;
}

function terminalNotApplicableJob(
  job: LingxingCollectionJobSnapshot,
  state: 'completed_with_errors' | 'failed' | 'cancelled' | 'stale_authority',
): LingxingCollectionJobSnapshot {
  const terminal = { ...job, state, importState: 'not_applicable' as const };
  delete terminal.importAttemptedAt;
  delete terminal.importCompletedAt;
  delete terminal.importError;
  return terminal;
}

async function harness(options: {
  durableJob?: (job: LingxingCollectionJobSnapshot) => LingxingCollectionJobSnapshot;
  coordinatorJob?: (job: LingxingCollectionJobSnapshot) => LingxingCollectionJobSnapshot;
} = {}) {
  const stores = new MemoryStoreRepository();
  const sessions = new MemorySessions();
  const storeA = store('store-a', 'profile-a');
  const storeB = store('store-b', 'profile-b');
  stores.stores.set(storeA.storeId, storeA);
  stores.stores.set(storeB.storeId, storeB);
  const coordinatorAuthority = new StoreCoordinator({
    repository: stores,
    sessions,
    now: () => NOW,
  });
  coordinatorAuthority.switchStore(storeA.storeId);
  const domain = new StoreCollectionOrchestratorDomainAdapter({
    coordinator: coordinatorAuthority,
    scheduler: { inspectForStore: () => ({ state: 'not_due' }) } as never,
    now: () => NOW,
  });
  const automation = domain.issueAutomationAuthority('orchestrator-owner');
  const before = (await domain.readActiveAuthority(automation)).authority;
  const businessDate = '2026-07-23';
  const window = deriveStoreCollectionWindow(businessDate, 7);
  const fingerprint = storeCollectionScheduleSemanticFingerprint({
    storeId: storeB.storeId,
    browserProfileId: storeB.browserProfileId,
    businessDate,
    lookbackDays: 7,
    ...window,
  });
  const executionScope: StoreCollectionTransitionCapabilityScope<'transition_execution'> = {
    capabilityDomain: 'transition_execution',
    capabilityId: 'transition-capability-1',
    cycleId: 'cycle-1',
    transitionId: 'transition-1',
    purpose: 'collection',
    fromAuthority: before,
    originAuthority: before,
    target: {
      storeId: storeB.storeId,
      browserProfileId: storeB.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
    },
    expectedFingerprint: fingerprint,
  };
  const executionCapability = await domain.deriveTransitionCapability({
    ...automation,
    scope: executionScope,
  });
  const transitioned = await domain.transitionAuthorityForCollection({
    ...automation,
    transitionCapability: executionCapability.transitionCapability,
    transitionScope: executionScope,
    reason: 'collection_automation',
    mode: 'collection_only',
    previous: before,
    target: executionScope.target,
  });
  const context = transitioned.current.context!;
  const identity = deriveStoreCollectionSchedulerExecutionIdentity({
    cycleId: executionScope.cycleId,
    transitionId: executionScope.transitionId,
    fingerprint,
    transitionScope: executionScope,
    context,
  });
  const executeInput = {
    ...automation,
    transitionCapability: executionCapability.transitionCapability,
    transitionScope: executionScope,
    context,
    expectedAuthority: transitioned.current,
    cycleId: executionScope.cycleId,
    transitionId: executionScope.transitionId,
    expectedFingerprint: fingerprint,
    ...identity,
  };
  let currentConfig = config(storeB.storeId);
  const getForStoreId = vi.fn(() => currentConfig);
  const jobs = new MemoryJobs();
  const start = vi.fn(async (input: Parameters<
    StoreCollectionOrchestratorSchedulerAdapterOptionsForTest['start']
  >[0]) => {
    const base = completeJob(input);
    const coordinatorJob = options.coordinatorJob?.(base) ?? base;
    jobs.rows.push(structuredClone(options.durableJob?.(base) ?? coordinatorJob));
    return { result: { job: coordinatorJob } } as never;
  });
  const adapter = new StoreCollectionOrchestratorSchedulerAdapter({
    domain,
    config: { getForStoreId },
    coordinator: { start },
    repository: jobs,
  });

  const recoveryInput = async () => {
    const admission = await domain.registerSchedulerRecoveryAdmission({
      ...automation,
      executionScope,
      context,
      ...identity,
    });
    const recoveryScope: StoreCollectionTransitionCapabilityScope<'recovery_existing_request_only'> = {
      ...executionScope,
      capabilityDomain: 'recovery_existing_request_only',
      capabilityId: `${executionScope.capabilityId}:recovery`,
    };
    const recovered = await domain.deriveTransitionCapability({
      ...automation,
      scope: recoveryScope,
      recoveryAdmission: admission.recoveryAdmission,
      recoveryScopeDigest: admission.scopeDigest,
      schedulerAttemptId: admission.attemptId,
      schedulerRequestId: admission.requestId,
    });
    return {
      ...automation,
      transitionCapability: recovered.transitionCapability,
      transitionScope: recoveryScope,
      context,
      expectedAuthority: transitioned.current,
      cycleId: executionScope.cycleId,
      transitionId: executionScope.transitionId,
      expectedFingerprint: fingerprint,
      ...identity,
    };
  };

  return {
    adapter,
    automation,
    context,
    coordinatorAuthority,
    domain,
    executeInput,
    executionScope,
    fingerprint,
    getForStoreId,
    identity,
    jobs,
    recoveryInput,
    setConfig(next: StoreRuntimeConfigProjection) { currentConfig = next; },
    start,
    storeA,
    storeB,
    transitioned,
    window,
  };
}

type StoreCollectionOrchestratorSchedulerAdapterOptionsForTest = {
  start(input: {
    requestId: string;
    storeContext: StoreContextEnvelope;
    dateStart: string;
    dateEnd: string;
    mode: 'create-and-download' | 'download-existing';
    reportTypes?: readonly LingxingReportType[];
    canary?: boolean;
  }): Promise<unknown>;
};

describe('StoreCollectionOrchestratorSchedulerAdapter', () => {
  it('executes one non-canary full-eight create/download request and proves its durable binding', async () => {
    const test = await harness();

    const projection = await test.adapter.execute(test.executeInput);

    expect(test.start).toHaveBeenCalledTimes(1);
    expect(test.start).toHaveBeenCalledWith({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
      canary: false,
    });
    expect(projection).toMatchObject({
      state: 'accepted',
      accepted: true,
      duplicate: false,
      cycleId: 'cycle-1',
      transitionId: 'transition-1',
      fingerprint: test.fingerprint,
      attemptId: test.identity.attemptId,
      requestId: test.identity.requestId,
      authority: test.transitioned.current,
    });
    expect(projection.capability).toBe(test.executeInput.capability);
    expect(projection.transitionCapability).toBe(test.executeInput.transitionCapability);
    expect(projection.transitionScope).toBe(test.executeInput.transitionScope);
  });

  it('rejects a pre-existing exact request before coordinator/browser side effects', async () => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));

    await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/拒绝复用既有/);
    expect(test.start).not.toHaveBeenCalled();
  });

  it('rejects forged, replayed, and scope-aliased transition capabilities', async () => {
    const replay = await harness();
    await replay.adapter.execute(replay.executeInput);
    await expect(replay.adapter.execute(replay.executeInput)).rejects.toThrow(/replayed/);

    const forged = await harness();
    await expect(forged.adapter.execute({
      ...forged.executeInput,
      transitionCapability: Object.freeze({}) as never,
    })).rejects.toThrow(/forged/);
    expect(forged.start).not.toHaveBeenCalled();

    const wrongOwner = await harness();
    await expect(wrongOwner.adapter.execute({
      ...wrongOwner.executeInput,
      owner: 'different-owner',
    })).rejects.toThrow(/owner-mismatched/);
    expect(wrongOwner.start).not.toHaveBeenCalled();

    const aliased = await harness();
    await expect(aliased.adapter.execute({
      ...aliased.executeInput,
      transitionScope: { ...aliased.executionScope },
    })).rejects.toThrow(/scope-mismatched/);
    expect(aliased.start).not.toHaveBeenCalled();
  });

  it('rejects config/fingerprint drift and cross Store/Profile/Generation authority', async () => {
    const configDrift = await harness();
    configDrift.setConfig(config(configDrift.storeB.storeId, 14));
    await expect(configDrift.adapter.execute(configDrift.executeInput))
      .rejects.toThrow(/fingerprint 已漂移/);
    expect(configDrift.start).not.toHaveBeenCalled();

    for (const contextMutation of [
      { storeId: configDrift.storeA.storeId },
      { browserProfileId: configDrift.storeA.browserProfileId },
      { sessionGeneration: configDrift.context.sessionGeneration + 1 },
    ]) {
      const test = await harness();
      const context = normalizeStoreContextEnvelope({ ...test.context, ...contextMutation });
      await expect(test.adapter.execute({
        ...test.executeInput,
        context,
      })).rejects.toThrow();
      expect(test.start).not.toHaveBeenCalled();
    }

    const authorityDrift = await harness();
    authorityDrift.coordinatorAuthority.reconnectStore(authorityDrift.storeB.storeId);
    await expect(authorityDrift.adapter.execute(authorityDrift.executeInput))
      .rejects.toThrow(/stale against current Main authority/);
    expect(authorityDrift.start).not.toHaveBeenCalled();

    for (const unavailable of [
      { current: null, versions: [] } satisfies StoreRuntimeConfigProjection,
      {
        ...config(configDrift.storeB.storeId),
        current: {
          ...config(configDrift.storeB.storeId).current!,
          status: 'archived' as const,
          archivedAt: '2026-07-23T00:00:00.000Z',
        },
      },
    ]) {
      const test = await harness();
      test.setConfig(unavailable);
      await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/active runtime config/);
      expect(test.start).not.toHaveBeenCalled();
    }
  });

  it('rejects canary-shaped or non-derived scheduler request identity', async () => {
    const test = await harness();
    await expect(test.adapter.execute({
      ...test.executeInput,
      requestId: `canary:${test.fingerprint}`,
    })).rejects.toThrow(/安全 cycle.*attempt.*request identity/);
    expect(test.start).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'wrong dates',
      mutate: (job: LingxingCollectionJobSnapshot) => ({
        ...job,
        request: { ...job.request, dateStart: '2026-07-01' },
      }),
    },
    {
      name: 'wrong mode',
      mutate: (job: LingxingCollectionJobSnapshot) => ({
        ...job,
        request: { ...job.request, mode: 'download-existing' as const },
      }),
    },
    {
      name: 'partial report request',
      mutate: (job: LingxingCollectionJobSnapshot) => ({
        ...job,
        request: { ...job.request, reportTypes: REPORT_TYPES.slice(0, 7) },
      }),
    },
  ])('rejects a durable $name identity', async ({ mutate }) => {
    const test = await harness({ coordinatorJob: mutate });
    await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/identity mismatch/);
  });

  it('rejects coordinator-result versus durable-job disagreement', async () => {
    const test = await harness({
      durableJob: (job) => ({ ...job, importState: 'failed', importError: 'mismatch' }),
    });
    await expect(test.adapter.execute(test.executeInput))
      .rejects.toThrow(/coordinator result.*durable authority DB job 不一致/);
  });

  it('fails closed on duplicate request ambiguity without coordinator side effects', async () => {
    const test = await harness();
    const job = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    test.jobs.rows.push(job, { ...job, jobId: 'duplicate-job' });
    await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/ambiguity/);
    expect(test.start).not.toHaveBeenCalled();
  });

  it('recovers only the existing exact request and never invokes the coordinator', async () => {
    const states: Array<{
      name: string;
      mutate?: (job: LingxingCollectionJobSnapshot) => LingxingCollectionJobSnapshot;
      expected: string;
      durable?: boolean;
      exact?: boolean;
    }> = [
      { name: 'missing', expected: 'not_found', durable: false },
      {
        name: 'queued',
        expected: 'accepted',
        mutate: (job) => {
          const queued = {
            ...job,
            state: 'queued' as const,
            reports: job.reports.map((checkpoint) => ({
              ...checkpoint,
              state: 'queued' as const,
            })),
          };
          delete queued.completedAt;
          delete queued.importState;
          delete queued.importAttemptedAt;
          delete queued.importCompletedAt;
          return queued;
        },
      },
      {
        name: 'running',
        expected: 'waiting',
        mutate: (job) => {
          const running = {
            ...job,
            state: 'running' as const,
          };
          delete running.completedAt;
          delete running.importState;
          delete running.importAttemptedAt;
          delete running.importCompletedAt;
          return running;
        },
      },
      {
        name: 'completed import pending',
        expected: 'waiting',
        mutate: (job) => {
          const pending = { ...job, importState: 'pending' as const };
          delete pending.importCompletedAt;
          return pending;
        },
      },
      {
        name: 'completed legacy import missing',
        expected: 'unknown',
        mutate: (job) => {
          const legacy = { ...job };
          delete legacy.importState;
          delete legacy.importAttemptedAt;
          delete legacy.importCompletedAt;
          return legacy;
        },
      },
      {
        name: 'completed with partial checkpoints',
        expected: 'unknown',
        exact: false,
        mutate: (job) => ({ ...job, reports: job.reports.slice(0, 7) }),
      },
      {
        name: 'completed with failed import',
        expected: 'failed',
        mutate: (job) => ({ ...job, importState: 'failed' as const, importError: 'bad rows' }),
      },
      {
        name: 'completed_with_errors',
        expected: 'failed',
        mutate: (job) => {
          const terminal = {
            ...job,
            state: 'completed_with_errors' as const,
            importState: 'not_applicable' as const,
          };
          delete terminal.importAttemptedAt;
          delete terminal.importCompletedAt;
          delete terminal.importError;
          return terminal;
        },
      },
      {
        name: 'failed terminal',
        expected: 'failed',
        mutate: (job) => {
          const terminal = {
            ...job,
            state: 'failed' as const,
            importState: 'not_applicable' as const,
          };
          delete terminal.importAttemptedAt;
          delete terminal.importCompletedAt;
          delete terminal.importError;
          return terminal;
        },
      },
      {
        name: 'cancelled terminal',
        expected: 'failed',
        mutate: (job) => {
          const terminal = {
            ...job,
            state: 'cancelled' as const,
            importState: 'not_applicable' as const,
          };
          delete terminal.importAttemptedAt;
          delete terminal.importCompletedAt;
          delete terminal.importError;
          return terminal;
        },
      },
      {
        name: 'stale authority terminal',
        expected: 'failed',
        mutate: (job) => {
          const terminal = {
            ...job,
            state: 'stale_authority' as const,
            importState: 'not_applicable' as const,
          };
          delete terminal.importAttemptedAt;
          delete terminal.importCompletedAt;
          delete terminal.importError;
          return terminal;
        },
      },
      { name: 'successful exact 8/8', expected: 'succeeded' },
    ];

    for (const scenario of states) {
      const test = await harness();
      if (scenario.durable !== false) {
        const job = completeJob({
          requestId: test.identity.requestId,
          storeContext: test.context,
          dateStart: test.window.dateStart,
          dateEnd: test.window.dateEnd,
          mode: 'create-and-download',
          reportTypes: REPORT_TYPES,
        });
        test.jobs.rows.push(scenario.mutate?.(job) ?? job);
      }
      const input = await test.recoveryInput();
      const projection = await test.adapter.recover(input);
      expect(projection.state, scenario.name).toBe(scenario.expected);
      if (scenario.durable === false
        || scenario.exact === false
        || scenario.expected === 'waiting'
        || scenario.expected === 'unknown') {
        expect(projection.accepted, scenario.name).toBeUndefined();
        expect(projection.duplicate, scenario.name).toBeUndefined();
      } else {
        expect(projection.accepted, scenario.name).toBe(true);
        expect(projection.duplicate, scenario.name).toBe(false);
      }
      expect(projection, scenario.name).toMatchObject({
        cycleId: input.cycleId,
        transitionId: input.transitionId,
        fingerprint: input.expectedFingerprint,
        attemptId: input.attemptId,
        requestId: input.requestId,
        authority: input.expectedAuthority,
      });
      expect(projection.capability, scenario.name).toBe(input.capability);
      expect(projection.transitionCapability, scenario.name).toBe(input.transitionCapability);
      expect(projection.transitionScope, scenario.name).toBe(input.transitionScope);
      expect(test.start, scenario.name).not.toHaveBeenCalled();
    }
  });

  it('recovers the frozen historical Store/Profile/window after Main authority and config move elsewhere', async () => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));
    test.coordinatorAuthority.switchStore(test.storeA.storeId);
    test.setConfig({ current: null, versions: [] });

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection).toMatchObject({
      state: 'succeeded',
      accepted: true,
      duplicate: false,
      authority: test.transitioned.current,
    });
    expect(test.getForStoreId).not.toHaveBeenCalled();
    expect(test.start).not.toHaveBeenCalled();
  });

  it.each(([
    {
      name: 'queued without batch',
      mutateJob: queuedJob,
      expected: 'accepted',
    },
    {
      name: 'queued with pending batch without completion',
      mutateJob: queuedJob,
      mutateProof: (proof) => ({ ...proof, batch: nonterminalBatchForProof(proof, 'pending') }),
      expected: 'accepted',
    },
    {
      name: 'queued with completed pending batch',
      mutateJob: queuedJob,
      mutateProof: (proof) => ({
        ...proof,
        batch: nonterminalBatchForProof(proof, 'pending', '2026-07-23T16:05:00.000Z'),
      }),
      expected: 'unknown',
    },
    {
      name: 'queued with import error',
      mutateJob: (job) => ({ ...queuedJob(job), importError: 'impossible' }),
      expected: 'unknown',
    },
    {
      name: 'running without batch',
      mutateJob: runningJob,
      expected: 'waiting',
    },
    {
      name: 'running with running batch without completion',
      mutateJob: runningJob,
      mutateProof: (proof) => ({ ...proof, batch: nonterminalBatchForProof(proof, 'running') }),
      expected: 'waiting',
    },
    {
      name: 'running with completed running batch',
      mutateJob: runningJob,
      mutateProof: (proof) => ({
        ...proof,
        batch: nonterminalBatchForProof(proof, 'running', '2026-07-23T16:05:00.000Z'),
      }),
      expected: 'unknown',
    },
    {
      name: 'running with import attempt',
      mutateJob: (job) => ({
        ...runningJob(job),
        importAttemptedAt: '2026-07-23T16:04:00.000Z',
      }),
      expected: 'unknown',
    },
    {
      name: 'completed pending without attempted timestamp',
      mutateJob: (job) => {
        const pending = { ...job, importState: 'pending' as const };
        delete pending.importAttemptedAt;
        delete pending.importCompletedAt;
        delete pending.importError;
        return pending;
      },
      expected: 'waiting',
    },
    {
      name: 'completed pending with canonical attempted timestamp',
      mutateJob: (job) => {
        const pending = { ...job, importState: 'pending' as const };
        delete pending.importCompletedAt;
        delete pending.importError;
        return pending;
      },
      expected: 'waiting',
    },
    {
      name: 'completed pending with import completion',
      mutateJob: (job) => ({ ...job, importState: 'pending' as const }),
      expected: 'unknown',
    },
    {
      name: 'completed pending with import error',
      mutateJob: (job) => {
        const pending = { ...job, importState: 'pending' as const, importError: 'impossible' };
        delete pending.importCompletedAt;
        return pending;
      },
      expected: 'unknown',
    },
    {
      name: 'completed failed with full lifecycle',
      mutateJob: (job) => ({ ...job, importState: 'failed' as const, importError: 'bad rows' }),
      expected: 'failed',
    },
    {
      name: 'completed failed without import completion',
      mutateJob: (job) => {
        const failed = { ...job, importState: 'failed' as const, importError: 'bad rows' };
        delete failed.importCompletedAt;
        return failed;
      },
      expected: 'unknown',
    },
    {
      name: 'completed failed with empty error',
      mutateJob: (job) => ({ ...job, importState: 'failed' as const, importError: '   ' }),
      expected: 'unknown',
    },
    {
      name: 'completed succeeded with full 8/8 proof',
      mutateJob: (job) => job,
      expected: 'succeeded',
    },
    {
      name: 'completed succeeded with import error',
      mutateJob: (job) => ({ ...job, importError: 'impossible' }),
      expected: 'unknown',
    },
    {
      name: 'terminal not_applicable with empty import lifecycle',
      mutateJob: (job) => terminalNotApplicableJob(job, 'failed'),
      expected: 'failed',
    },
    {
      name: 'terminal not_applicable with import attempt',
      mutateJob: (job) => ({
        ...terminalNotApplicableJob(job, 'failed'),
        importAttemptedAt: '2026-07-23T16:04:00.000Z',
      }),
      expected: 'unknown',
    },
    {
      name: 'terminal not_applicable without batch completion',
      mutateJob: (job) => terminalNotApplicableJob(job, 'failed'),
      mutateProof: (proof) => ({
        ...proof,
        batch: proof.batch ? { ...proof.batch, completedAt: undefined } : undefined,
      }),
      expected: 'unknown',
    },
  ] satisfies Array<{
    name: string;
    mutateJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot;
    mutateProof?: (proof: LingxingCollectionAuthorityProof) => LingxingCollectionAuthorityProof;
    expected: 'accepted' | 'waiting' | 'failed' | 'succeeded' | 'unknown';
  }>))('enforces the unified lifecycle matrix: $name', async ({ mutateJob, mutateProof, expected }) => {
    const test = await harness();
    const base = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    test.jobs.rows.push(mutateJob(base));
    test.jobs.mutateProof = mutateProof;

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection.state).toBe(expected);
    if (expected === 'accepted' || expected === 'failed' || expected === 'succeeded') {
      expect(projection).toMatchObject({ accepted: true, duplicate: false });
    } else {
      expect(projection.accepted).toBeUndefined();
      expect(projection.duplicate).toBeUndefined();
    }
  });

  it.each([
    {
      name: 'missing one durable Lingxing file',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        lingxingFileCount: 7,
        lingxingFiles: proof.lingxingFiles.slice(0, 7),
      }),
    },
    {
      name: 'file size differs from downloaded checkpoint',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        lingxingFiles: proof.lingxingFiles.map((file, index) => (
          index === 0 ? { ...file, fileSizeBytes: file.fileSizeBytes! + 1 } : file
        )),
      }),
    },
    {
      name: 'created report identity has the wrong date window',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        job: {
          ...proof.job,
          reports: proof.job.reports.map((checkpoint, index) => (
            index === 0
              ? {
                  ...checkpoint,
                  createdReportIdentity: {
                    ...checkpoint.createdReportIdentity!,
                    dateStart: '2026-07-01',
                  },
                }
              : checkpoint
          )),
        },
      }),
    },
    {
      name: 'multiple completed import runs',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importRunCount: 2,
        importRuns: [
          ...proof.importRuns,
          { ...proof.importRuns[0]!, runId: 'second-completed-run' },
        ],
      }),
    },
    {
      name: 'immutable import snapshot hash is malformed',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importFileSnapshots: proof.importFileSnapshots.map((snapshot, index) => (
          index === 0 ? { ...snapshot, fileHash: 'not-a-sha256' } : snapshot
        )),
      }),
    },
    {
      name: 'imported report file is not imported',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importedReportFiles: proof.importedReportFiles.map((file, index) => (
          index === 0 ? { ...file, status: 'pending' } : file
        )),
      }),
    },
    {
      name: 'import snapshot points at another Lingxing file',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importFileSnapshots: proof.importFileSnapshots.map((snapshot, index) => (
          index === 0 ? { ...snapshot, lingxingFileId: 'foreign-file' } : snapshot
        )),
      }),
    },
  ])('does not promote succeeded when $name', async ({ mutate }) => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));
    test.jobs.mutateProof = mutate;

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection.state).toBe('unknown');
    expect(projection.accepted).toBeUndefined();
    expect(projection.duplicate).toBeUndefined();
    expect(test.start).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'job timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        job: { ...proof.job, createdAt: '1' },
      }),
    },
    {
      name: 'batch timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        batch: { ...proof.batch!, createdAt: '1' },
      }),
    },
    {
      name: 'created report identity timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        job: {
          ...proof.job,
          reports: proof.job.reports.map((checkpoint, index) => (
            index === 0
              ? {
                  ...checkpoint,
                  createdReportIdentity: {
                    ...checkpoint.createdReportIdentity!,
                    createdAt: '1',
                  },
                }
              : checkpoint
          )),
        },
      }),
    },
    {
      name: 'import run timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importRuns: proof.importRuns.map((run, index) => (
          index === 0 ? { ...run, completedAt: '1' } : run
        )),
      }),
    },
    {
      name: 'immutable snapshot timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importFileSnapshots: proof.importFileSnapshots.map((snapshot, index) => (
          index === 0 ? { ...snapshot, capturedAt: '1' } : snapshot
        )),
      }),
    },
    {
      name: 'imported file timestamp',
      mutate: (proof: LingxingCollectionAuthorityProof) => ({
        ...proof,
        importedReportFiles: proof.importedReportFiles.map((file, index) => (
          index === 0 ? { ...file, lastImportedAt: '1' } : file
        )),
      }),
    },
  ])('rejects Date.parse-compatible but non-canonical UTC $name', async ({ mutate }) => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));
    test.jobs.mutateProof = mutate;

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection.state).toBe('unknown');
    expect(projection.accepted).toBeUndefined();
    expect(projection.duplicate).toBeUndefined();
  });

  it('maps impossible job/import combinations to unknown without terminal flags', async () => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }, {
      state: 'completed_with_errors',
      importState: 'succeeded',
    }));

    const projection = await test.adapter.recover(await test.recoveryInput());

    expect(projection.state).toBe('unknown');
    expect(projection.accepted).toBeUndefined();
    expect(projection.duplicate).toBeUndefined();
  });

  it('fails closed on duplicate durable recovery rows without invoking the coordinator', async () => {
    const test = await harness();
    const job = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    test.jobs.rows.push(job, { ...job, jobId: 'duplicate-recovery-job' });
    await expect(test.adapter.recover(await test.recoveryInput())).rejects.toThrow(/ambiguity/);
    expect(test.start).not.toHaveBeenCalled();
  });

  it('rejects forged recovery identity/capability and never creates or repairs a job', async () => {
    const wrongIdentity = await harness();
    const input = await wrongIdentity.recoveryInput();
    await expect(wrongIdentity.adapter.recover({
      ...input,
      requestId: `scr:${'f'.repeat(64)}`,
    })).rejects.toThrow(/forged|replayed|scope-mismatched|复算/);
    expect(wrongIdentity.start).not.toHaveBeenCalled();
    expect(wrongIdentity.jobs.rows).toEqual([]);

    const forged = await harness();
    const forgedInput = await forged.recoveryInput();
    await expect(forged.adapter.recover({
      ...forgedInput,
      transitionCapability: Object.freeze({}) as never,
    })).rejects.toThrow(/forged/);
    expect(forged.start).not.toHaveBeenCalled();
    expect(forged.jobs.rows).toEqual([]);
  });
});
