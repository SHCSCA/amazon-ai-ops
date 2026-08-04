import { isDeepStrictEqual } from 'node:util';
import type {
  BusinessDate,
  LingxingCollectionJobSnapshot,
  ListStoreDailyStatusesInput,
  OperatorWorkspaceSelection,
  StoreConnection,
  StoreConnectionProvider,
  StoreDailyCollectionStatus,
  StoreDailyImportStatus,
  StoreDailyMetricStatus,
  StoreDailyOverallState,
  StoreDailyProviderStatus,
  StoreDailyStatusBlocker,
  StoreDailyStatusListProjection,
  StoreDailyStatusProjection,
  StoreId,
  StoreRecord,
  StoreSessionMetadata,
} from '@amazon-ai-ops/shared-types';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  DEFAULT_US_BUSINESS_TIMEZONE,
  normalizeLingxingCollectionStoreName,
  normalizeListStoreDailyStatusesInput,
  normalizeProviderExternalAccountId,
} from '@amazon-ai-ops/shared-types';
import type {
  LingxingCollectionAuthorityProof,
  LingxingImportRepository,
} from '@amazon-ai-ops/local-db';
import { classifyStoreCollectionDurableProof } from './store-collection-orchestrator-scheduler-adapter';
import type { StoreAuthorityRepository } from './store-coordinator';
import type { StoreSessionGenerationAuthority } from './store-coordinator';

const REQUIRED_REPORT_COUNT = 8 as const;
const REQUIRED_REPORTS = new Set<string>(ANALYSIS_REQUIRED_REPORT_TYPES);

export interface StoreDailyStatusProjectionReaderOptions {
  stores: Pick<
    StoreAuthorityRepository,
    'listStores' | 'listConnections' | 'listSessionMetadata'
  >;
  /** Must use a deferred/read transaction; this read model never claims a write lock. */
  readTransaction<Result>(work: () => Result): Result;
  generations: Pick<StoreSessionGenerationAuthority, 'current'>;
  imports: Pick<
    LingxingImportRepository,
    'listCollectionJobsForStore' | 'readUniqueCollectionAuthorityProofForStoreByRequestId'
  >;
  selection: Pick<{ getOperatorWorkspaceSelection(): OperatorWorkspaceSelection | null },
  'getOperatorWorkspaceSelection'>;
  /** Test seam; production always uses the strict durable proof classifier. */
  classifyProof?: typeof classifyStoreCollectionDurableProof;
  now?: () => Date;
}

/**
 * Cross-store read model. It opens one read transaction and never calls a
 * switch, generation advance, scheduler transition, or browser operation.
 */
export class StoreDailyStatusProjectionReader {
  private readonly now: () => Date;
  private readonly classifyProof: typeof classifyStoreCollectionDurableProof;

  constructor(private readonly options: StoreDailyStatusProjectionReaderOptions) {
    this.now = options.now ?? (() => new Date());
    this.classifyProof = options.classifyProof ?? classifyStoreCollectionDurableProof;
  }

  list(inputValue: ListStoreDailyStatusesInput): StoreDailyStatusListProjection {
    const input = normalizeListStoreDailyStatusesInput(inputValue);
    const now = this.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError('store daily status clock is invalid');
    }
    const generatedAt = now.toISOString();
    return this.options.readTransaction(() => {
      const selection = this.options.selection.getOperatorWorkspaceSelection();
      const stores = this.options.stores.listStores({ includeArchived: true })
        .filter((store) => store.marketplace === input.marketplace)
        .filter((store) => input.includeInactive || store.status !== 'inactive')
        .filter((store) => input.includeArchived || store.status !== 'archived')
        .map((store) => this.readStore(store, selection, now, generatedAt))
        .sort(compareDailyStatuses);
      return Object.freeze({
        schemaVersion: 1,
        marketplace: input.marketplace,
        generatedAt,
        stores: Object.freeze(stores),
      });
    });
  }

  private readStore(
    store: StoreRecord,
    selection: OperatorWorkspaceSelection | null,
    now: Date,
    generatedAt: string,
  ): StoreDailyStatusProjection {
    const businessDate = businessDateFor(now, DEFAULT_US_BUSINESS_TIMEZONE);
    const expectedMetricDate = shiftIsoDate(businessDate, -1);
    const blockers: StoreDailyStatusBlocker[] = [];
    if (!isExactUsStoreAuthority(store)) {
      blockers.push(blocker(
        'STORE_AUTHORITY_INVALID',
        'unknown',
        '店铺身份不是可验证的美国站 / USD / America/Los_Angeles 权威记录。',
      ));
    }
    if (store.status === 'inactive') {
      blockers.push(blocker('STORE_INACTIVE', 'blocking', '店铺已停用，不能进入采集或执行。'));
    } else if (store.status === 'archived') {
      blockers.push(blocker('STORE_ARCHIVED', 'blocking', '店铺已归档，不能进入采集或执行。'));
    }

    let providers: StoreDailyStatusProjection['providers'];
    try {
      providers = readProviders(
        this.options.stores.listConnections(store.storeId),
        this.options.stores.listSessionMetadata(store.storeId),
        store,
        this.options.generations.current(store.storeId),
        blockers,
      );
    } catch {
      providers = {
        lingxing: unknownProvider('lingxing'),
        amazonAds: unknownProvider('amazon_ads'),
      };
      blockers.push(blocker(
        'PROVIDER_AUTHORITY_UNKNOWN',
        'unknown',
        '店铺连接或会话记录无法唯一读取。',
      ));
    }

    let collection: StoreDailyCollectionStatus;
    let importStatus: StoreDailyImportStatus;
    let metrics: StoreDailyMetricStatus;
    try {
      ({ collection, importStatus, metrics } = this.readCollectionAndMetrics(
        store.storeId,
        businessDate,
        expectedMetricDate,
      ));
    } catch {
      collection = {
        state: 'unknown',
        requiredReportCount: REQUIRED_REPORT_COUNT,
      };
      importStatus = { state: 'unknown' };
      metrics = { freshness: 'unknown', expectedMetricDate };
    }
    appendEvidenceBlockers(collection, importStatus, metrics, blockers);

    const eligibleForCollection = store.status === 'active'
      && isExactUsStoreAuthority(store)
      && providers.lingxing.bindingState === 'ready'
      && providers.lingxing.sessionStatus === 'ready';
    const overall = deriveOverall(store, collection, importStatus, metrics, blockers);
    return Object.freeze({
      schemaVersion: 1,
      key: Object.freeze({
        storeId: store.storeId,
        marketplace: store.marketplace,
        businessDate,
      }),
      displayName: store.displayName,
      storeStatus: store.status,
      currency: store.currency,
      selected: selection?.storeId === store.storeId
        && selection.marketplace === store.marketplace,
      eligibleForCollection,
      providers: Object.freeze(providers),
      collection: Object.freeze(collection),
      import: Object.freeze(importStatus),
      metrics: Object.freeze(metrics),
      overall,
      blockers: Object.freeze(blockers),
      generatedAt,
    });
  }

  private readCollectionAndMetrics(
    storeId: StoreId,
    businessDate: BusinessDate,
    expectedMetricDate: string,
  ): {
    collection: StoreDailyCollectionStatus;
    importStatus: StoreDailyImportStatus;
    metrics: StoreDailyMetricStatus;
  } {
    const jobs = sortCollectionAuthorityAttempts(
      this.options.imports.listCollectionJobsForStore(storeId, 100)
        .filter(isProductionFullEightJob),
    );
    const proofCache = new Map<string, StrictProofAttempt>();
    const proofAttempt = (job: LingxingCollectionJobSnapshot): StrictProofAttempt => {
      const existing = proofCache.get(job.request.requestId);
      if (existing) return existing;
      try {
        const proof = this.options.imports.readUniqueCollectionAuthorityProofForStoreByRequestId(
          storeId,
          job.request.requestId,
        );
        if (!proof || !isDeepStrictEqual(proof.job, job)) {
          throw new Error('collection authority proof changed during projection read');
        }
        const classification = this.classifyProof(proof, {
          context: job.request.storeContext,
          requestId: job.request.requestId,
          dateStart: job.request.dateStart,
          dateEnd: job.request.dateEnd,
        });
        const readback = {
          state: 'verified',
          value: { proof, classification },
        } as const;
        proofCache.set(job.request.requestId, readback);
        return readback;
      } catch {
        const invalid = { state: 'invalid' } as const;
        proofCache.set(job.request.requestId, invalid);
        return invalid;
      }
    };

    const currentJobs = jobs.filter((job) => (
      job.request.storeContext.businessDate === businessDate
    ));
    const currentAttempts = currentJobs.map((job) => ({ job, attempt: proofAttempt(job) }));
    const nonterminalAuthorityCount = currentAttempts.filter(({ attempt }) => (
      attempt.state === 'verified' && attempt.value.classification === 'claimed'
    )).length;
    const current = currentAttempts[0];
    let collection: StoreDailyCollectionStatus;
    let importStatus: StoreDailyImportStatus;
    if (nonterminalAuthorityCount > 1) {
      collection = {
        state: 'unknown',
        requiredReportCount: REQUIRED_REPORT_COUNT,
      };
      importStatus = { state: 'unknown' };
    } else if (!current) {
      collection = {
        state: 'not_started',
        requiredReportCount: REQUIRED_REPORT_COUNT,
        downloadedReportCount: 0,
      };
      importStatus = { state: 'not_started' };
    } else if (current.attempt.state === 'invalid') {
      collection = {
        state: 'unknown',
        requiredReportCount: REQUIRED_REPORT_COUNT,
      };
      importStatus = { state: 'unknown' };
    } else {
      const { proof, classification } = current.attempt.value;
      const downloadedReportCount = proof.job.reports.filter(
        (checkpoint) => checkpoint.state === 'downloaded',
      ).length;
      collection = {
        state: classification === 'succeeded'
          ? 'succeeded'
          : classification === 'failed'
            ? 'failed'
            : current.job.state === 'queued'
              ? 'queued'
              : 'running',
        requiredReportCount: REQUIRED_REPORT_COUNT,
        downloadedReportCount,
        jobId: current.job.jobId,
        requestId: current.job.request.requestId,
        updatedAt: current.job.updatedAt,
        ...(current.job.completedAt ? { completedAt: current.job.completedAt } : {}),
      };
      importStatus = importProjection(proof, classification);
    }

    let latestSucceeded: LingxingCollectionAuthorityProof | undefined;
    let invalidProofSeen = false;
    for (const job of jobs) {
      const attempt = proofAttempt(job);
      if (attempt.state === 'invalid') {
        invalidProofSeen = true;
        continue;
      }
      if (attempt.value.classification === 'succeeded') {
        latestSucceeded = attempt.value.proof;
        break;
      }
    }
    const metrics = latestSucceeded
      ? metricProjection(latestSucceeded, expectedMetricDate)
      : invalidProofSeen
        ? { freshness: 'unknown' as const, expectedMetricDate }
        : { freshness: 'missing' as const, expectedMetricDate };
    return { collection, importStatus, metrics };
  }
}

type StrictProofReadback = Readonly<{
  proof: LingxingCollectionAuthorityProof;
  classification: 'claimed' | 'succeeded' | 'failed';
}>;

type StrictProofAttempt = Readonly<
  | { state: 'verified'; value: StrictProofReadback }
  | { state: 'invalid' }
>;

function readProviders(
  connections: readonly StoreConnection[],
  sessions: readonly StoreSessionMetadata[],
  store: StoreRecord,
  currentGeneration: number,
  blockers: StoreDailyStatusBlocker[],
): StoreDailyStatusProjection['providers'] {
  return {
    lingxing: readProvider(
      'lingxing', connections, sessions, store, currentGeneration, blockers,
    ),
    amazonAds: readProvider(
      'amazon_ads', connections, sessions, store, currentGeneration, blockers,
    ),
  };
}

function readProvider(
  provider: StoreConnectionProvider,
  connections: readonly StoreConnection[],
  sessions: readonly StoreSessionMetadata[],
  store: StoreRecord,
  currentGeneration: number,
  blockers: StoreDailyStatusBlocker[],
): StoreDailyProviderStatus {
  const matches = connections.filter((connection) => connection.provider === provider);
  const sessionMatches = sessions.filter((session) => session.provider === provider);
  if (matches.length > 1 || sessionMatches.length > 1) {
    blockers.push(blocker(
      'PROVIDER_AUTHORITY_UNKNOWN',
      'unknown',
      `${providerLabel(provider)}连接或会话不是唯一记录。`,
      provider,
    ));
    return unknownProvider(provider);
  }
  const connection = matches[0];
  if (!connection) {
    blockers.push(blocker(
      provider === 'lingxing' ? 'LINGXING_BINDING_MISSING' : 'AMAZON_ADS_BINDING_MISSING',
      provider === 'lingxing' ? 'blocking' : 'attention',
      `${providerLabel(provider)}尚未绑定到当前店铺。`,
      provider,
    ));
    return {
      provider,
      bindingState: 'missing',
      connectionStatus: 'missing',
      sessionStatus: 'missing',
    };
  }
  let normalizedExternalId: string | undefined;
  let normalizedCollectionStoreName: string | undefined;
  try {
    normalizedExternalId = normalizeProviderExternalAccountId(
      provider,
      connection.externalAccountId,
    );
    normalizedCollectionStoreName = provider === 'lingxing'
      ? normalizeLingxingCollectionStoreName(connection.collectionStoreName)
      : undefined;
  } catch {
    normalizedExternalId = undefined;
    normalizedCollectionStoreName = undefined;
  }
  const identityExact = Boolean(normalizedExternalId)
    && connection.normalizedExternalAccountId === normalizedExternalId
    && (provider !== 'lingxing' || (
      Boolean(connection.accountLabel?.trim())
      && Boolean(normalizedCollectionStoreName)
      && connection.normalizedCollectionStoreName === normalizedCollectionStoreName
    ));
  const bindingState = identityExact && connection.status !== 'blocked'
    ? 'ready'
    : 'invalid';
  if (bindingState !== 'ready') {
    blockers.push(blocker(
      provider === 'lingxing' ? 'LINGXING_BINDING_INVALID' : 'AMAZON_ADS_BINDING_INVALID',
      provider === 'lingxing' ? 'blocking' : 'attention',
      provider === 'lingxing'
        ? '领星下载中心店铺名称映射不完整或已失效。'
        : 'Amazon Ads Profile 映射不完整或已失效。',
      provider,
    ));
  }
  const session = sessionMatches[0] ?? connection.session;
  const sessionAuthorityExact = Boolean(session
    && session.storeId === store.storeId
    && session.browserProfileId === store.browserProfileId
    && session.sessionGeneration === currentGeneration);
  const effectiveSessionStatus = !session
    ? 'missing' as const
    : sessionAuthorityExact
      ? session.status
      : 'unknown' as const;
  if (effectiveSessionStatus !== 'ready') {
    blockers.push(blocker(
      provider === 'lingxing'
        ? 'LINGXING_SESSION_NOT_READY'
        : 'AMAZON_ADS_SESSION_NOT_READY',
      'attention',
      `${providerLabel(provider)}可见浏览器会话尚未就绪。`,
      provider,
    ));
  }
  return {
    provider,
    bindingState,
    connectionStatus: connection.status,
    sessionStatus: effectiveSessionStatus,
    ...(connection.lastVerifiedAt ? { lastVerifiedAt: connection.lastVerifiedAt } : {}),
    ...(sessionAuthorityExact && session?.observedAt
      ? { sessionObservedAt: session.observedAt }
      : {}),
  };
}

function unknownProvider(provider: StoreConnectionProvider): StoreDailyProviderStatus {
  return {
    provider,
    bindingState: 'unknown',
    connectionStatus: 'unknown',
    sessionStatus: 'unknown',
  };
}

function importProjection(
  proof: LingxingCollectionAuthorityProof,
  classification: StrictProofReadback['classification'],
): StoreDailyImportStatus {
  if (classification === 'succeeded') {
    const run = proof.importRuns[0];
    return {
      state: 'succeeded',
      importedReportCount: proof.importedReportFileCount,
      metricRowCount: proof.metricEvidence[0]?.rowCount,
      ...(proof.job.importCompletedAt || run?.completedAt
        ? { completedAt: proof.job.importCompletedAt ?? run!.completedAt }
        : {}),
    };
  }
  const state = proof.job.importState;
  if (state === 'failed') {
    return {
      state: 'failed',
      ...(proof.job.importCompletedAt ? { completedAt: proof.job.importCompletedAt } : {}),
    };
  }
  if (state === 'not_applicable') return { state: 'not_applicable' };
  if (state === 'pending') return { state: 'pending' };
  return classification === 'claimed' ? { state: 'not_started' } : { state: 'unknown' };
}

function metricProjection(
  proof: LingxingCollectionAuthorityProof,
  expectedMetricDate: string,
): StoreDailyMetricStatus {
  const dates = [...new Set(proof.reconciliations.map((row) => row.metricDate))]
    .sort((left, right) => right.localeCompare(left));
  const latestMetricDate = dates[0];
  const evidence = proof.metricEvidence[0];
  const run = proof.importRuns[0];
  if (!latestMetricDate || !evidence || !run) {
    return { freshness: 'unknown', expectedMetricDate };
  }
  const lagDays = dateDistance(latestMetricDate, expectedMetricDate);
  if (!Number.isSafeInteger(lagDays)) {
    return {
      freshness: 'unknown',
      expectedMetricDate,
      latestMetricDate,
      rowCount: evidence.rowCount,
      lastImportedAt: run.completedAt,
    };
  }
  if (lagDays < 0) {
    return {
      freshness: 'unknown',
      expectedMetricDate,
      latestMetricDate,
      rowCount: evidence.rowCount,
      lastImportedAt: run.completedAt,
    };
  }
  return {
    freshness: lagDays === 0 ? 'fresh' : 'stale',
    expectedMetricDate,
    latestMetricDate,
    lagDays,
    rowCount: evidence.rowCount,
    lastImportedAt: run.completedAt,
  };
}

function appendEvidenceBlockers(
  collection: StoreDailyCollectionStatus,
  importStatus: StoreDailyImportStatus,
  metrics: StoreDailyMetricStatus,
  blockers: StoreDailyStatusBlocker[],
): void {
  if (collection.state === 'failed') {
    blockers.push(blocker('COLLECTION_FAILED', 'blocking', '最近一次每日八报表采集失败。'));
  } else if (collection.state === 'unknown') {
    blockers.push(blocker(
      'COLLECTION_AUTHORITY_UNKNOWN',
      'unknown',
      '每日采集权威证据缺失、损坏或不唯一。',
    ));
  }
  if (importStatus.state === 'failed') {
    blockers.push(blocker('IMPORT_FAILED', 'blocking', '最近一次八报表导入失败。'));
  } else if (importStatus.state === 'unknown') {
    blockers.push(blocker(
      'IMPORT_AUTHORITY_UNKNOWN',
      'unknown',
      '导入证明缺失、损坏或不唯一。',
    ));
  }
  if (metrics.freshness === 'missing') {
    blockers.push(blocker('METRICS_MISSING', 'attention', '尚无可验证的广告指标。'));
  } else if (metrics.freshness === 'stale') {
    blockers.push(blocker('METRICS_STALE', 'attention', '最近广告指标早于应有业务日期。'));
  } else if (metrics.freshness === 'unknown') {
    blockers.push(blocker(
      'METRICS_AUTHORITY_UNKNOWN',
      'unknown',
      '广告指标日期或不可变导入证明无法验证。',
    ));
  }
}

function deriveOverall(
  store: StoreRecord,
  collection: StoreDailyCollectionStatus,
  importStatus: StoreDailyImportStatus,
  metrics: StoreDailyMetricStatus,
  blockers: readonly StoreDailyStatusBlocker[],
): StoreDailyOverallState {
  if (store.status === 'archived') return 'archived';
  if (store.status === 'inactive') return 'inactive';
  if (blockers.some((item) => item.severity === 'unknown')) return 'unknown';
  if (blockers.some((item) => item.severity === 'blocking')) return 'blocked';
  if (collection.state === 'queued' || collection.state === 'running'
    || importStatus.state === 'pending') return 'in_progress';
  if (collection.state === 'not_started') return 'not_started';
  if (collection.state === 'succeeded'
    && importStatus.state === 'succeeded'
    && metrics.freshness === 'fresh'
    && blockers.length === 0) return 'ready';
  return 'attention_required';
}

function isProductionFullEightJob(job: LingxingCollectionJobSnapshot): boolean {
  const reports = job.request.reportTypes;
  return job.request.mode === 'create-and-download'
    && !job.request.requestId.startsWith('canary:')
    && reports.length === REQUIRED_REPORT_COUNT
    && new Set(reports).size === REQUIRED_REPORT_COUNT
    && reports.every((reportType) => REQUIRED_REPORTS.has(reportType));
}

function sortCollectionAuthorityAttempts(
  jobs: readonly LingxingCollectionJobSnapshot[],
): LingxingCollectionJobSnapshot[] {
  const jobIds = new Set<string>();
  const requestIds = new Set<string>();
  const candidates = jobs.map((job) => {
    const createdAtMs = Date.parse(job.createdAt);
    if (!Number.isFinite(createdAtMs)
      || jobIds.has(job.jobId)
      || requestIds.has(job.request.requestId)) {
      throw new Error('collection attempt creation authority is invalid or duplicated');
    }
    jobIds.add(job.jobId);
    requestIds.add(job.request.requestId);
    return { job, createdAtMs };
  });
  return candidates
    .sort((left, right) => (
      right.createdAtMs - left.createdAtMs
      || right.job.jobId.localeCompare(left.job.jobId, 'en-US')
    ))
    .map(({ job }) => job);
}

function isExactUsStoreAuthority(store: StoreRecord): boolean {
  return store.marketplace === 'US'
    && store.currency === 'USD'
    && store.businessTimezone === DEFAULT_US_BUSINESS_TIMEZONE;
}

function blocker(
  code: StoreDailyStatusBlocker['code'],
  severity: StoreDailyStatusBlocker['severity'],
  detail: string,
  provider?: StoreConnectionProvider,
): StoreDailyStatusBlocker {
  return Object.freeze({ code, severity, detail, ...(provider ? { provider } : {}) });
}

function providerLabel(provider: StoreConnectionProvider): string {
  return provider === 'lingxing' ? '领星' : 'Amazon Ads';
}

function compareDailyStatuses(
  left: StoreDailyStatusProjection,
  right: StoreDailyStatusProjection,
): number {
  if (left.selected !== right.selected) return left.selected ? -1 : 1;
  const statusRank = { active: 0, inactive: 1, archived: 2 } as const;
  const byStatus = statusRank[left.storeStatus] - statusRank[right.storeStatus];
  if (byStatus !== 0) return byStatus;
  const byName = left.displayName.localeCompare(right.displayName, 'en-US', {
    sensitivity: 'base',
    numeric: true,
  });
  return byName || String(left.key.storeId).localeCompare(String(right.key.storeId));
}

function businessDateFor(now: Date, timeZone: string): BusinessDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}` as BusinessDate;
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateDistance(left: string, right: string): number {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`);
  const rightTime = Date.parse(`${right}T00:00:00.000Z`);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return Number.NaN;
  return Math.trunc((rightTime - leftTime) / 86_400_000);
}
