import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, expect } from 'vitest';
import { fingerprintKeywordBidPageSnapshot } from '@amazon-ai-ops/action-executor';
import  {
  BrowserLeaseManager,
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import  {
  AnalysisAuthorityRepository,
  ExecutionAuthorityRepository,
  MissionDomainRepository,
  initSqlite,
} from '@amazon-ai-ops/local-db';
import { normalizeStoreContextEnvelope, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { ExecutionAuthorityService, type ExecutionAuthorityServiceOptions } from './execution-authority-service';
import { type PolicyDispatchSuppressionReadPort } from './store-collection-policy-suppression';
import { FakeExecutionPage } from './execution-authority-service.test-browser';
import { seedAuthority } from './execution-authority-service.test-authority';
export const NOW = '2026-07-23T02:00:00.000Z';

export const TARGET_PATH = '/ad_report/target/index/index';

export const tempDirs: string[] = [];

export const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) {
    const database = databases.pop();
    if (database?.open) database.close();
  }
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

export interface Harness {
  context: StoreContextEnvelope;
  database: Database.Database;
  executionRepository: ExecutionAuthorityRepository;
  missionRepository: MissionDomainRepository;
  service: ExecutionAuthorityService;
  page: FakeExecutionPage;
  batchId: string;
  leases: BrowserLeaseManager;
  runtimeResolutionCount(): number;
  setRuntimeReady(ready: boolean): void;
  setBringToFrontError(error: Error | undefined): void;
  setBringToFrontWork(work: (() => Promise<void>) | undefined): void;
  setNow(value: string): void;
}

export interface HarnessOptions {
  logger?: ExecutionAuthorityServiceOptions['logger'];
  policyGrant?: boolean;
  createBatch?: boolean;
  registerIdentity?: boolean;
  runtimeReady?: boolean;
  adsReady?: boolean;
  now?: string;
  executionWindow?: {
    timeZone: 'America/Los_Angeles';
    daysOfWeek: number[];
    start: string;
    end: string;
  };
  policyDispatchRetryMs?: number;
  policyDispatchTimer?: NonNullable<ExecutionAuthorityServiceOptions['policyDispatchTimer']>;
  policyDispatchSuppression?: PolicyDispatchSuppressionReadPort;
  emitProgress?: ExecutionAuthorityServiceOptions['emitProgress'];
}

export class MutablePolicyDispatchSuppression implements PolicyDispatchSuppressionReadPort {
  private suppressed: boolean;
  readError?: Error;

  constructor(suppressed = false) {
    this.suppressed = suppressed;
  }

  isPolicyDispatchSuppressed(): boolean {
    if (this.readError) throw this.readError;
    return this.suppressed;
  }

  setSuppressed(value: boolean): void {
    this.suppressed = value;
  }
}

export function createHarness(actionCount = 1, options: HarnessOptions = {}): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-execution-service-'));
  tempDirs.push(directory);
  const database = initSqlite(path.join(directory, 'app.db'));
  databases.push(database);
  seedAuthority(
    database,
    actionCount,
    options.policyGrant ? 'policy' : 'human',
    options.executionWindow,
  );
  if (options.adsReady === false) {
    database.prepare(`
      UPDATE store_connections
      SET status = 'blocked', last_failure_code = 'offline', updated_at = ?
      WHERE store_id = 'store-one' AND provider = 'amazon_ads'
    `).run(NOW);
    database.prepare(`
      UPDATE store_session_metadata
      SET status = 'blocked', failure_code = 'offline', updated_at = ?
      WHERE store_id = 'store-one' AND provider = 'amazon_ads'
    `).run(NOW);
  }
  let currentNow = options.now ?? NOW;
  const now = () => new Date(currentNow);
  const context = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  const executionRepository = new ExecutionAuthorityRepository(database, { now });
  if (options.registerIdentity !== false) {
    executionRepository.registerCanonicalKeywordIdentity(context, {
      adEntityId: 'opaque-keyword-1',
      entityRevision: 1,
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-1',
      adGroupId: 'ad-group-1',
      keywordId: 'keyword-1',
      observedBidCents: 149,
      pageIdentityHash: fingerprintKeywordBidPageSnapshot({
        pageIdentity: {
          url: `https://ads.lingxing.com${TARGET_PATH}?profile_id=ads-account-1&id=campaign-1`,
          origin: 'https://ads.lingxing.com',
          pathname: TARGET_PATH,
          adsAccountId: 'ads-account-1',
          campaignId: 'campaign-1',
          marketplace: 'US',
          currency: 'USD',
          matchedTextMarkers: [],
        },
        keyword: { keywordId: 'keyword-1', adGroupId: 'ad-group-1', bidCents: 149 },
      }),
      resolutionProofSha256: '8'.repeat(64),
      resolvedAt: NOW,
      resolvedBy: 'operator',
    });
  }
  if (actionCount > 1 && options.registerIdentity !== false) {
    executionRepository.registerCanonicalKeywordIdentity(context, {
      adEntityId: 'opaque-keyword-2',
      entityRevision: 1,
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-2',
      adGroupId: 'ad-group-2',
      keywordId: 'keyword-2',
      observedBidCents: 200,
      pageIdentityHash: fingerprintKeywordBidPageSnapshot({
        pageIdentity: {
          url: `https://ads.lingxing.com${TARGET_PATH}?profile_id=ads-account-1&id=campaign-2`,
          origin: 'https://ads.lingxing.com',
          pathname: TARGET_PATH,
          adsAccountId: 'ads-account-1',
          campaignId: 'campaign-2',
          marketplace: 'US',
          currency: 'USD',
          matchedTextMarkers: [],
        },
        keyword: { keywordId: 'keyword-2', adGroupId: 'ad-group-2', bidCents: 200 },
      }),
      resolutionProofSha256: '7'.repeat(64),
      resolvedAt: NOW,
      resolvedBy: 'operator',
    });
  }
  const missionRepository = new MissionDomainRepository(database, { now });
  const page = new FakeExecutionPage();
  if (options.registerIdentity === false) page.keywordId = 'opaque-keyword-1';
  const capsule = createCapsule(directory, context);
  let runtimeReady = options.runtimeReady ?? true;
  let resolvedRuntimeCount = 0;
  let bringToFrontError: Error | undefined;
  let bringToFrontWork: (() => Promise<void>) | undefined;
  const leases = new BrowserLeaseManager(
    () => now().getTime(),
    () => 'stage6-lease-token-0001',
  );
  const service = new ExecutionAuthorityService({
    ...(options.logger ? { logger: options.logger } : {}),
    repository: executionRepository,
    missionRepository,
    analysisRepository: new AnalysisAuthorityRepository(database, { now }),
    storeCoordinator: {
      assertActiveStoreContext: (input) => {
        expect(input).toEqual(context);
        return context;
      },
      getActiveStoreContext: () => context,
    },
    leases,
    resolveBrowserRuntime: () => {
      resolvedRuntimeCount += 1;
      if (!runtimeReady) throw new Error('visible browser runtime unavailable');
      return {
        context,
        externalAccountId: 'ads-account-1',
        page,
        capsule,
        navigate: async (url: string) => {
          page.selectCampaign(new URL(url).searchParams.get('id') ?? 'campaign-1');
        },
        bringToFront: async () => {
          if (bringToFrontError) throw bringToFrontError;
          await bringToFrontWork?.();
        },
      };
    },
    now,
    policyDispatchSuppression: options.policyDispatchSuppression
      ?? new MutablePolicyDispatchSuppression(false),
    ...(options.emitProgress ? { emitProgress: options.emitProgress } : {}),
    ...(options.policyDispatchRetryMs !== undefined
      ? { policyDispatchRetryMs: options.policyDispatchRetryMs }
      : {}),
    ...(options.policyDispatchTimer
      ? { policyDispatchTimer: options.policyDispatchTimer }
      : {}),
  });
  const batchId = options.createBatch === false
    ? ''
    : service.createBatch({ context, grantId: 'grant-1' }).projection.batch.id;
  return {
    context,
    database,
    executionRepository,
    missionRepository,
    service,
    page,
    batchId,
    leases,
    runtimeResolutionCount: () => resolvedRuntimeCount,
    setRuntimeReady: (ready) => { runtimeReady = ready; },
    setBringToFrontError: (error) => { bringToFrontError = error; },
    setBringToFrontWork: (work) => { bringToFrontWork = work; },
    setNow: (value) => { currentNow = value; },
  };
}

export function createCapsule(directory: string, context: StoreContextEnvelope): StoreCapsulePaths {
  return ensureStoreCapsulePaths(deriveStoreCapsulePaths(
    path.join(directory, 'trusted-stores'),
    context.storeId,
    context.browserProfileId,
  ));
}

export function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export class FakePolicyDispatchTimer {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();
  private readonly callbackHistory = new Map<number, () => void>();
  readonly setCalls: Array<{ id: number; delayMs: number }> = [];
  readonly cleared: number[] = [];

  readonly timer: NonNullable<ExecutionAuthorityServiceOptions['policyDispatchTimer']> = {
    set: (callback, delayMs) => {
      const id = this.nextId;
      this.nextId += 1;
      this.callbacks.set(id, callback);
      this.callbackHistory.set(id, callback);
      this.setCalls.push({ id, delayMs });
      return id;
    },
    clear: (handle) => {
      const id = Number(handle);
      this.callbacks.delete(id);
      this.cleared.push(id);
    },
  };

  runLatest(): void {
    const latest = this.setCalls[this.setCalls.length - 1];
    if (!latest) throw new Error('No policy dispatch timer is scheduled.');
    const callback = this.callbacks.get(latest.id);
    if (!callback) return;
    this.callbacks.delete(latest.id);
    callback();
  }

  forceRunLatest(): void {
    const latest = this.setCalls[this.setCalls.length - 1];
    if (!latest) throw new Error('No policy dispatch timer was scheduled.');
    this.callbackHistory.get(latest.id)?.();
  }

  activeCount(): number {
    return this.callbacks.size;
  }
}
