import { vi } from 'vitest';
import { readStoreCollectionAutomation } from '@amazon-ai-ops/shared-types';
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
import type {
  LingxingCollectionAuthorityProof,
  LingxingCollectionSemanticScope,
} from '@amazon-ai-ops/local-db';
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
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

export const REPORT_TYPES = LINGXING_AD_REPORTS.map((report) => report.type);

export const NOW = new Date('2026-07-23T16:00:00.000Z');

export function sameReportSet(
  left: readonly LingxingReportType[],
  right: readonly LingxingReportType[],
): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((reportType) => right.includes(reportType));
}

export class MemoryStoreRepository implements StoreAuthorityRepository {
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

export class MemorySessions implements StoreSessionGenerationAuthority {
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

export class MemoryJobs {
  readonly rows: LingxingCollectionJobSnapshot[] = [];
  mutateProof?: (proof: LingxingCollectionAuthorityProof) => LingxingCollectionAuthorityProof;
  beforeSemanticInspection?: (scope: LingxingCollectionSemanticScope) => void;
  readonly inspectUniqueCollectionJobForSemanticScope = vi.fn((
    scope: LingxingCollectionSemanticScope,
  ): LingxingCollectionAuthorityProof | undefined => {
    this.beforeSemanticInspection?.(scope);
    const rows = this.rows.filter((job) => {
      const context = normalizeStoreContextEnvelope(job.request.storeContext);
      return context.storeId === scope.storeId
        && context.browserProfileId === scope.browserProfileId
        && context.marketplace === 'US'
        && context.currency === 'USD'
        && context.businessTimezone === 'America/Los_Angeles'
        && context.businessDate === scope.businessDate
        && job.request.dateStart === scope.dateStart
        && job.request.dateEnd === scope.dateEnd
        && job.request.mode === scope.mode
        && sameReportSet(job.request.reportTypes, scope.reportTypes);
    });
    if (rows.length > 1) throw new Error('duplicate durable semantic ambiguity');
    return rows[0] ? authorityProofForJob(structuredClone(rows[0])) : undefined;
  });
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

export function store(storeId: string, profileId: string): StoreRecord {
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

export function config(storeId: StoreId, lookbackDays = 7): StoreRuntimeConfigProjection {
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

export function completeJob(
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

export function authorityProofForJob(
  job: LingxingCollectionJobSnapshot,
  options: { committedImportEvidence?: boolean } = {},
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
    displayName: `${checkpoint.reportType} 人类可读报表标签`,
    status: 'downloaded' as const,
    filePath: `C:\\reports\\${job.jobId}\\${checkpoint.reportType}.xlsx`,
    fileSizeBytes: checkpoint.fileSizeBytes ?? 1024,
    createdAt: job.createdAt,
    updatedAt: checkpoint.updatedAt,
  }));
  const committed = job.state === 'completed'
    && (options.committedImportEvidence === true || job.importState === 'succeeded');
  const run = committed ? {
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
    createdAt: job.importCompletedAt ?? job.updatedAt,
  } : undefined;
  const importedReportFiles = committed ? lingxingFiles.map((file, index) => ({
    id: index + 1,
    storeId: context.storeId,
    batchId: job.jobId,
    reportType: file.reportType,
    filePath: file.filePath!,
    fileName: file.filePath!.split('\\').pop()!,
    fileSizeBytes: file.fileSizeBytes!,
    status: 'imported',
    importedRows: 10,
    fileHash: `${(index + 1).toString(16)}`.repeat(64).slice(0, 64),
    lastImportedAt: run!.completedAt,
  })) : [];
  const importFileSnapshots = committed ? lingxingFiles.map((file, index) => ({
    storeId: context.storeId,
    snapshotId: `snapshot-${file.reportType}`,
    runId: run!.runId,
    batchId: job.jobId,
    lingxingFileId: file.id,
    reportFileId: importedReportFiles[index]!.id,
    reportType: file.reportType,
    filePath: file.filePath!,
    fileName: file.filePath!.split('\\').pop()!,
    fileSizeBytes: file.fileSizeBytes!,
    fileHash: importedReportFiles[index]!.fileHash!,
    importedRows: importedReportFiles[index]!.importedRows,
    capturedAt: run!.completedAt,
  })) : [];
  const reconciliations = committed ? lingxingFiles.map((file, index) => ({
    storeId: context.storeId,
    reconciliationId: `reconciliation-${file.reportType}`,
    runId: run!.runId,
    batchId: job.jobId,
    dateStart: job.request.dateStart,
    dateEnd: job.request.dateEnd,
    metricDate: job.request.dateEnd,
    reportType: file.reportType,
    currency: 'USD' as const,
    expectedRows: 10,
    actualRows: 10,
    expectedCost: index + 1,
    actualCost: index + 1,
    absoluteCostDelta: 0,
    tolerance: 0.01,
    withinTolerance: true,
    status: 'matched' as const,
    reconciledAt: run!.completedAt,
  })) : [];
  const metricEvidence = committed ? [{
    storeId: context.storeId,
    runId: run!.runId,
    batchId: job.jobId,
    rowCount: run!.metricRowCount,
    payloadSha256: 'f'.repeat(64),
    createdAt: run!.completedAt,
  }] : [];
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
    reconciliationRowCount: reconciliations.length,
    reconciliations,
    metricEvidenceCount: metricEvidence.length,
    metricEvidence,
  };
}

export function nonterminalBatchForProof(
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

export function queuedJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
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

export function runningJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
  const running = { ...job, state: 'running' as const };
  delete running.completedAt;
  delete running.importState;
  delete running.importAttemptedAt;
  delete running.importCompletedAt;
  delete running.importError;
  return running;
}

export function terminalNotApplicableJob(
  job: LingxingCollectionJobSnapshot,
  state: 'completed_with_errors' | 'failed' | 'cancelled' | 'stale_authority',
): LingxingCollectionJobSnapshot {
  const terminal = { ...job, state, importState: 'not_applicable' as const };
  delete terminal.importAttemptedAt;
  delete terminal.importCompletedAt;
  delete terminal.importError;
  return terminal;
}

export async function harness(options: {
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
  let currentConfig = config(storeB.storeId);
  const getForStoreId = vi.fn(() => currentConfig);
  const jobs = new MemoryJobs();
  const domain = new StoreCollectionOrchestratorDomainAdapter({
    automationControl: { getForStoreRecord: (record) => readStoreCollectionAutomation(null, record) },
    coordinator: coordinatorAuthority,
    scheduler: { inspectForStore: () => ({ state: 'not_due' }) } as never,
    config: {
      getForStoreRecord: (record) => (
        record.storeId === storeB.storeId ? currentConfig : config(record.storeId)
      ),
    },
    repository: jobs,
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

export type StoreCollectionOrchestratorSchedulerAdapterOptionsForTest = {
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
