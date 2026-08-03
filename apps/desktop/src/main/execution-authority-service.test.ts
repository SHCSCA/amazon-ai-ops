import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
  PlaywrightKeywordBidLocatorLike,
  PlaywrightKeywordBidPageLike,
} from '@amazon-ai-ops/action-executor';
import { fingerprintKeywordBidPageSnapshot } from '@amazon-ai-ops/action-executor';
import {
  BrowserLeaseManager,
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  AnalysisAuthorityRepository,
  ExecutionAuthorityRepository,
  MissionDomainRepository,
  initSqlite,
} from '@amazon-ai-ops/local-db';
import { normalizeStoreContextEnvelope, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  ExecutionAuthorityService,
  type ExecutionAuthorityServiceOptions,
} from './execution-authority-service';
import {
  StoreCollectionPolicySuppressionController,
  type PolicyDispatchSuppressionReadPort,
} from './store-collection-policy-suppression';

const NOW = '2026-07-23T02:00:00.000Z';
const TARGET_PATH = '/ad_report/target/index/index';
const tempDirs: string[] = [];
const databases: Database.Database[] = [];

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

class FakeLocator implements PlaywrightKeywordBidLocatorLike {
  constructor(
    private readonly page: FakeExecutionPage,
    private readonly kind: 'body' | 'marker' | 'row' | 'links' | 'bid' | 'save' | 'missing',
  ) {}

  async count(): Promise<number> {
    if (['body', 'marker', 'row', 'links', 'bid', 'save'].includes(this.kind)) return 1;
    return 0;
  }

  first(): PlaywrightKeywordBidLocatorLike { return this; }
  nth(): PlaywrightKeywordBidLocatorLike { return this; }

  locator(selector: string): PlaywrightKeywordBidLocatorLike {
    if (this.kind === 'marker' && selector === 'xpath=ancestor::tr[1]') return new FakeLocator(this.page, 'row');
    if (this.kind === 'row' && selector === 'a[href*="ad_group_id="]') return new FakeLocator(this.page, 'links');
    if (this.kind === 'row' && selector === '.form-control.price') return new FakeLocator(this.page, 'bid');
    if (this.kind === 'row' && selector === '.Js-bid-save') return new FakeLocator(this.page, 'save');
    return new FakeLocator(this.page, 'missing');
  }

  async getAttribute(name: string): Promise<string | null> {
    if (this.kind === 'marker' && name === 'value') return this.page.keywordId;
    if (this.kind === 'links' && name === 'href') {
      return `/ad_report/group?ad_group_id=${this.page.adGroupId}`;
    }
    return null;
  }

  async inputValue(): Promise<string> {
    if (this.kind === 'bid' && this.page.inputValueError) throw this.page.inputValueError;
    return this.kind === 'bid' ? this.page.bidValue : '';
  }
  async fill(value: string): Promise<void> { if (this.kind === 'bid') this.page.bidValue = value; }

  async click(): Promise<void> {
    if (this.kind !== 'save') return;
    this.page.clickCount += 1;
    if (this.page.clickError) throw this.page.clickError;
  }

  async isVisible(): Promise<boolean> { return this.kind === 'save'; }
  async isEnabled(): Promise<boolean> {
    if (this.kind !== 'save') return false;
    if (this.page.pauseBeforePermit) {
      this.page.signalPrepareSaveReady();
      await this.page.waitForPermitRelease();
    }
    return true;
  }
  async innerText(): Promise<string> { return this.kind === 'body' ? 'Amazon Ads' : 'door lock exact'; }
}

class FakeExecutionPage implements PlaywrightKeywordBidPageLike {
  bidValue = '$1.49';
  campaignId = 'campaign-1';
  adGroupId = 'ad-group-1';
  keywordId = 'keyword-1';
  clickCount = 0;
  clickError?: Error;
  inputValueError?: Error;
  pauseBeforePermit = false;
  private screenshotCount = 0;
  private afterScreenshotSignalled = false;
  private releaseAfterScreenshot?: () => void;
  readonly afterScreenshotStarted = new Promise<void>((resolve) => {
    this.releaseAfterScreenshot = resolve;
  });
  private readonly afterScreenshotGate = deferred();
  private readonly prepareSaveGate = deferred();
  private releasePrepareSave?: () => void;
  readonly prepareSaveReady = new Promise<void>((resolve) => {
    this.releasePrepareSave = resolve;
  });

  url(): string {
    return `https://ads.lingxing.com${TARGET_PATH}?profile_id=ads-account-1&id=${this.campaignId}`;
  }

  locator(selector: string): PlaywrightKeywordBidLocatorLike {
    if (selector === 'body') return new FakeLocator(this, 'body');
    if (selector === `input.select-item[value="${this.keywordId}"]`
      || selector === 'input.select-item[value="opaque-keyword-1"]') {
      return new FakeLocator(this, 'marker');
    }
    return new FakeLocator(this, 'missing');
  }

  selectCampaign(campaignId: string): void {
    this.campaignId = campaignId;
    const second = campaignId === 'campaign-2';
    this.adGroupId = second ? 'ad-group-2' : 'ad-group-1';
    const usesOpaqueStage5Id = this.keywordId.startsWith('opaque-keyword-');
    this.keywordId = usesOpaqueStage5Id
      ? (second ? 'opaque-keyword-2' : 'opaque-keyword-1')
      : (second ? 'keyword-2' : 'keyword-1');
    this.bidValue = second ? '$2.00' : '$1.49';
  }

  async reload(): Promise<unknown> { return null; }

  async screenshot(options: { path: string; fullPage: false }): Promise<unknown> {
    this.screenshotCount += 1;
    fs.writeFileSync(options.path, Buffer.from(`screenshot-${this.screenshotCount}`));
    if (this.clickCount > 0 && !this.afterScreenshotSignalled) {
      this.afterScreenshotSignalled = true;
      this.releaseAfterScreenshot?.();
      await this.afterScreenshotGate.promise;
    }
    return null;
  }

  allowAfterScreenshot(): void {
    this.afterScreenshotGate.resolve();
  }

  signalPrepareSaveReady(): void { this.releasePrepareSave?.(); }
  waitForPermitRelease(): Promise<void> { return this.prepareSaveGate.promise; }
  allowPermitCheck(): void { this.prepareSaveGate.resolve(); }
}

interface Harness {
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

interface HarnessOptions {
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
}

class MutablePolicyDispatchSuppression implements PolicyDispatchSuppressionReadPort {
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

function createHarness(actionCount = 1, options: HarnessOptions = {}): Harness {
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

describe('ExecutionAuthorityService safety orchestration', () => {
  it('requires an explicit policy suppression read port at type and runtime boundaries', () => {
    type SuppressionPortIsRequired = ExecutionAuthorityServiceOptions extends {
      policyDispatchSuppression: PolicyDispatchSuppressionReadPort;
    } ? true : false;
    expectTypeOf<SuppressionPortIsRequired>().toEqualTypeOf<true>();
    expect(() => new ExecutionAuthorityService(
      {} as ExecutionAuthorityServiceOptions,
    )).toThrow('policyDispatchSuppression read port is required');
  });

  it('holds an exact external-write lease through visible browser takeover', async () => {
    const harness = createHarness();
    const started = deferred();
    const release = deferred();
    harness.setBringToFrontWork(async () => {
      started.resolve();
      await release.promise;
    });

    const takeover = harness.service.takeOverVisibleBrowser({
      context: harness.context,
      batchId: harness.batchId,
    });
    await started.promise;

    expect(harness.leases.current(harness.context.storeId)).toMatchObject({
      purpose: 'external_write',
      owner: `takeover:${harness.batchId}`,
    });
    expect(() => harness.leases.enterTransitionBarrier('store-switch'))
      .toThrowError(expect.objectContaining({ code: 'LEASES_ACTIVE' }));

    release.resolve();
    await expect(takeover).resolves.toEqual({ status: 'VISIBLE', batchId: harness.batchId });
    expect(harness.leases.current(harness.context.storeId)).toBeUndefined();
  });

  it('cannot start browser takeover while a user transition barrier is held', async () => {
    const harness = createHarness();
    harness.leases.enterTransitionBarrier('store-switch');

    await expect(harness.service.takeOverVisibleBrowser({
      context: harness.context,
      batchId: harness.batchId,
    })).rejects.toMatchObject({ code: 'TRANSITION_BARRIER_HELD' });
    expect(harness.runtimeResolutionCount()).toBe(0);
  });

  it('drains an admitted visible-browser takeover and rejects later browser admission', async () => {
    const harness = createHarness();
    const started = deferred();
    const release = deferred();
    harness.setBringToFrontWork(async () => {
      started.resolve();
      await release.promise;
    });
    const events: string[] = [];

    const takeover = harness.service.takeOverVisibleBrowser({
      context: harness.context,
      batchId: harness.batchId,
    }).then((result) => {
      events.push('takeover-settled');
      return result;
    });
    await started.promise;
    const shutdown = harness.service.prepareForShutdown(1_000).then(() => {
      events.push('shutdown-settled');
    });

    await expect(harness.service.takeOverVisibleBrowser({
      context: harness.context,
      batchId: harness.batchId,
    })).rejects.toThrow('应用正在退出，禁止启动新的外部写入。');
    await Promise.resolve();
    expect(events).toEqual([]);

    release.resolve();
    await takeover;
    await shutdown;
    expect(events).toEqual(['takeover-settled', 'shutdown-settled']);
  });

  it('drains identity resolution admitted before shutdown', async () => {
    const harness = createHarness(1, { registerIdentity: false, createBatch: false });
    const started = deferred();
    const release = deferred();
    harness.setBringToFrontWork(async () => {
      started.resolve();
      await release.promise;
    });
    const events: string[] = [];

    const resolving = harness.service.resolveIdentity({
      context: harness.context,
      grantId: 'grant-1',
      adEntityId: 'opaque-keyword-1',
    }).then((identity) => {
      events.push('identity-settled');
      return identity;
    });
    await started.promise;
    const shutdown = harness.service.prepareForShutdown(1_000).then(() => {
      events.push('shutdown-settled');
    });
    await Promise.resolve();
    expect(events).toEqual([]);

    release.resolve();
    await expect(resolving).resolves.toMatchObject({ adEntityId: 'opaque-keyword-1' });
    await shutdown;
    expect(events).toEqual(['identity-settled', 'shutdown-settled']);
  });

  it('drains admitted legacy browser work and keeps admission closed after a timeout retry', async () => {
    const harness = createHarness();
    const started = deferred();
    const release = deferred();
    const legacy = harness.service.withAdmittedBrowserOperation(
      'legacy:collect-ad-report',
      async () => {
        started.resolve();
        await release.promise;
        return 'done';
      },
    );
    await started.promise;

    await expect(harness.service.prepareForShutdown(10)).rejects.toMatchObject({
      name: 'ExecutionAuthorityShutdownError',
      code: 'DRAIN_TIMEOUT',
    });
    await expect(harness.service.withAdmittedBrowserOperation(
      'legacy:late-work',
      async () => 'not-run',
    )).rejects.toThrow('应用正在退出，禁止启动新的外部写入。');

    release.resolve();
    await expect(legacy).resolves.toBe('done');
    await expect(harness.service.prepareForShutdown(100)).resolves.toBeUndefined();
  });

  it('cancels before submit intent without clicking save', () => {
    const harness = createHarness();

    const projection = harness.service.cancelBatch({
      context: harness.context,
      batchId: harness.batchId,
      reason: 'operator stopped before execution',
    });

    expect(projection.batch.status).toBe('cancelled');
    expect(projection.jobs).toEqual([expect.objectContaining({ status: 'cancelled', submitIntentId: undefined })]);
    expect(harness.page.clickCount).toBe(0);
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'cancelled', evidenceRefCount: 0 });
  });

  it('marks a thrown save result UNKNOWN after durable intent and never retries the click', async () => {
    const harness = createHarness();
    harness.page.clickError = new Error('browser disconnected during save');

    const projection = await harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });

    expect(projection.batch.status).toBe('unknown');
    expect(projection.jobs).toEqual([expect.objectContaining({
      status: 'unknown',
      submitIntentId: expect.any(String),
      events: expect.arrayContaining([
        expect.objectContaining({ eventType: 'unknown', reasonCode: 'SUBMIT_OUTCOME_UNKNOWN' }),
      ]),
    })]);
    expect(harness.page.clickCount).toBe(1);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toEqual(expect.objectContaining({ eventType: 'revoked' }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-1'))
      .toEqual(expect.objectContaining({ status: 'approved' }));
    expect(harness.database.prepare(`
      SELECT evidence_type AS evidenceType, evidence_ref AS evidenceRef
      FROM evidence_refs
      WHERE store_id = 'store-one' AND event_id = 'causal:grant:grant-1:revoked'
    `).all()).toEqual([
      { evidenceType: 'ad_execution_before', evidenceRef: expect.any(String) },
    ]);
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'unknown', evidenceRefCount: 1 });
  });

  it('revalidates the kill switch after the final save control is resolved and before click', async () => {
    const harness = createHarness();
    harness.page.pauseBeforePermit = true;
    const running = harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    await harness.page.prepareSaveReady;
    harness.database.prepare(`
      UPDATE policy_runtime SET kill_switch = 1, revision = revision + 1, updated_at = ?
      WHERE store_id = 'store-one'
    `).run(NOW);
    harness.page.allowPermitCheck();

    const projection = await running;

    expect(harness.page.clickCount).toBe(0);
    expect(projection.batch.status).toBe('blocked');
    expect(projection.jobs[0]).toMatchObject({
      status: 'blocked',
      submitIntentId: undefined,
    });
  });

  it('serializes a two-action batch and stops the untouched sibling after the first UNKNOWN', async () => {
    const harness = createHarness(2);
    harness.page.clickError = new Error('first save result became ambiguous');

    const projection = await harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });

    expect(harness.page.clickCount).toBe(1);
    expect(projection.batch.status).toBe('unknown');
    expect(projection.jobs.map((job) => job.status)).toEqual(['unknown', 'cancelled']);
    expect(projection.jobs[0]).toEqual(expect.objectContaining({
      submitIntentId: expect.any(String),
    }));
    expect(projection.jobs[1]).toEqual(expect.objectContaining({ submitIntentId: undefined }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-1'))
      .toEqual(expect.objectContaining({ status: 'approved' }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-2'))
      .toEqual(expect.objectContaining({ status: 'approved' }));
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'unknown', evidenceRefCount: 1 });
  });

  it('consumes the grant only after the complete batch passes after and reload evidence', async () => {
    const harness = createHarness();
    const running = harness.service.startBatch({ context: harness.context, batchId: harness.batchId });
    await harness.page.afterScreenshotStarted;

    expect(harness.page.clickCount).toBe(1);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1')).toBeUndefined();

    harness.page.allowAfterScreenshot();
    const projection = await running;
    expect(projection.batch.status).toBe('succeeded');
    expect(projection.jobs).toEqual([expect.objectContaining({ status: 'succeeded' })]);
    expect(projection.jobs[0].evidence.map((evidence) => evidence.slot)).toEqual(['before', 'after', 'reload']);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toEqual(expect.objectContaining({ eventType: 'consumed' }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-1'))
      .toEqual(expect.objectContaining({ status: 'verified' }));
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM evidence_refs
      WHERE store_id = 'store-one' AND event_id = 'causal:grant:grant-1:consumed'
    `).get()).toEqual({ count: 3 });
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'succeeded', evidenceRefCount: 3 });
  });

  it('keeps startup alive when one recovered domain projection fails and retries it later', () => {
    const harness = createHarness();
    const job = harness.executionRepository.getExecutionBatch(harness.context, harness.batchId)!.jobs[0]!;
    harness.executionRepository.markBlocked(harness.context, {
      jobId: job.id,
      expectedRevision: job.revision,
      reasonCode: 'test_recovery_block',
      detail: 'Test recovery projection isolation',
    });
    const completion = vi.spyOn(harness.executionRepository, 'completeDomainReconciliation')
      .mockImplementationOnce(() => { throw new Error('injected domain projection failure'); });

    let recovery: ReturnType<ExecutionAuthorityService['recoverStartup']> | undefined;
    expect(() => { recovery = harness.service.recoverStartup(); }).not.toThrow();
    expect(recovery?.domainReconciliations).toEqual([
      expect.objectContaining({ batchId: harness.batchId, status: 'blocked' }),
    ]);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ count: 0 });

    completion.mockRestore();
    expect(() => harness.service.reconcileActiveStore(harness.context)).not.toThrow();
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'blocked' });
  });

  it('keeps a suppressed policy grant durably pending with zero runtime, identity, or batch side effects', async () => {
    const suppression = new MutablePolicyDispatchSuppression(true);
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      policyDispatchSuppression: suppression,
    });
    const createBatch = vi.spyOn(harness.executionRepository, 'createExactExecutionBatch');
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(() => harness.service.recoverStartup()).not.toThrow();
    await Promise.resolve();

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'pending',
      attemptCount: 0,
      code: 'DISPATCH_PENDING',
      batchJobCount: 0,
    });
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(createBatch).not.toHaveBeenCalled();
    expect(harness.executionRepository.listCanonicalKeywordIdentities(harness.context)).toEqual([]);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 0 });
    expect(harness.page.clickCount).toBe(0);

    suppression.setSuppressed(false);
    await Promise.resolve();
    expect(harness.runtimeResolutionCount()).toBe(0);
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'completed', attemptCount: 1 });
    expect(harness.page.clickCount).toBe(1);
  });

  it('keeps startup_unknown recovery, resume, and due retry side-effect free until explicit confirmation and resume', async () => {
    const timer = new FakePolicyDispatchTimer();
    const controller = new StoreCollectionPolicySuppressionController();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      policyDispatchTimer: timer.timer,
      policyDispatchSuppression: controller,
    });
    const createBatch = vi.spyOn(harness.executionRepository, 'createExactExecutionBatch');
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);
    harness.executionRepository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: grant.id,
      status: 'attempting',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'Seed a pre-startup retry without browser work.',
    });
    harness.executionRepository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: grant.id,
      status: 'waiting_runtime',
      trigger: 'timer_retry',
      attempt: 1,
      code: 'RUNTIME_UNAVAILABLE',
      detail: 'Seed a due startup retry.',
      nextRetryAt: NOW,
    });

    expect(() => harness.service.recoverStartup()).not.toThrow();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    await Promise.resolve();

    expect(controller.inspectPolicyDispatchSuppression()).toMatchObject({
      state: 'startup_unknown',
      suppressed: true,
    });
    expect(timer.activeCount()).toBe(0);
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(createBatch).not.toHaveBeenCalled();
    expect(harness.executionRepository.listCanonicalKeywordIdentities(harness.context)).toEqual([]);
    expect(harness.page.clickCount).toBe(0);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 0 });

    const recoveryCapability = controller.issueStartupRecoveryConfirmationCapability();
    expect(controller.confirmStartupRecoverySafe(recoveryCapability)).toEqual({
      capability: recoveryCapability,
      startupRecoverySafe: true,
    });
    await Promise.resolve();
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(createBatch).not.toHaveBeenCalled();
    expect(harness.page.clickCount).toBe(0);

    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'completed', attemptCount: 2 });
    expect(harness.page.clickCount).toBe(1);
  });

  it('fails closed when suppression readback throws and leaves policy dispatch pending', async () => {
    const suppression = new MutablePolicyDispatchSuppression();
    suppression.readError = new Error('suppression authority unavailable');
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      policyDispatchSuppression: suppression,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'pending', attemptCount: 0 });
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(harness.page.clickCount).toBe(0);
  });

  it('holds an attempt that becomes suppressed immediately after its durable attempt event', async () => {
    const timer = new FakePolicyDispatchTimer();
    const suppression = new MutablePolicyDispatchSuppression();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      policyDispatchTimer: timer.timer,
      policyDispatchSuppression: suppression,
    });
    const append = harness.executionRepository.appendPolicyGrantDispatchEvent
      .bind(harness.executionRepository);
    let suppressionInjected = false;
    vi.spyOn(harness.executionRepository, 'appendPolicyGrantDispatchEvent')
      .mockImplementation((context, input) => {
        const result = append(context, input);
        if (input.status === 'attempting' && !suppressionInjected) {
          suppressionInjected = true;
          suppression.setSuppressed(true);
        }
        return result;
      });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    const held = harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]!;
    expect(held).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'RUNTIME_UNAVAILABLE',
      batchJobCount: 0,
    });
    expect(held).not.toHaveProperty('nextRetryAt');
    expect(harness.runtimeResolutionCount()).toBe(0);
    expect(timer.activeCount()).toBe(0);
    expect(harness.page.clickCount).toBe(0);

    suppression.setSuppressed(false);
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'completed', attemptCount: 2 });
  });

  it('drops a due retry while suppressed and requires explicit resume after release', async () => {
    const timer = new FakePolicyDispatchTimer();
    const suppression = new MutablePolicyDispatchSuppression();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      runtimeReady: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
      policyDispatchSuppression: suppression,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    await harness.service.enqueuePolicyGrant(harness.context, grant);
    expect(timer.activeCount()).toBe(1);
    expect(harness.runtimeResolutionCount()).toBe(1);

    suppression.setSuppressed(true);
    harness.setRuntimeReady(true);
    timer.runLatest();
    await Promise.resolve();
    expect(timer.activeCount()).toBe(0);
    expect(harness.runtimeResolutionCount()).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'waiting_runtime', attemptCount: 1 });

    suppression.setSuppressed(false);
    harness.page.allowAfterScreenshot();
    await Promise.resolve();
    expect(harness.runtimeResolutionCount()).toBe(1);
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0])
      .toMatchObject({ status: 'completed', attemptCount: 2 });
    expect(harness.page.clickCount).toBe(1);
  });

  it('finishes an in-flight dispatch but suppression prevents the next durable lane item', async () => {
    const suppression = new MutablePolicyDispatchSuppression();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      policyDispatchSuppression: suppression,
    });
    seedSecondSameStorePolicyGrant(harness.database);
    registerSecondIdentity(harness);
    const firstGrant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    const secondGrant = harness.missionRepository.getMissionGrant(harness.context, 'grant-2')!;

    const first = harness.service.enqueuePolicyGrant(harness.context, firstGrant);
    await harness.page.afterScreenshotStarted;
    const second = harness.service.enqueuePolicyGrant(harness.context, secondGrant);
    suppression.setSuppressed(true);
    harness.page.allowAfterScreenshot();
    await Promise.all([first, second]);

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ grantId: 'grant-1', status: 'completed' }),
        expect.objectContaining({ grantId: 'grant-2', status: 'pending', attemptCount: 0 }),
      ]));
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-2'
    `).get()).toEqual({ count: 0 });

    suppression.setSuppressed(false);
    await Promise.resolve();
    expect(harness.page.clickCount).toBe(1);
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.page.clickCount).toBe(2);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ grantId: 'grant-2', status: 'completed' }),
      ]));
  });

  it('does not own or release the collection suppression guard during shutdown', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    const recoveryCapability = controller.issueStartupRecoveryConfirmationCapability();
    const lease = await controller.acquirePolicyDispatchSuppression({
      owner: 'collection-owner',
      capability: Object.freeze({}) as never,
    });
    const harness = createHarness(1, {
      policyDispatchSuppression: controller,
    });

    await harness.service.prepareForShutdown(10);

    expect(controller.inspectPolicyDispatchSuppression()).toMatchObject({
      state: 'startup_unknown',
      suppressed: true,
      activeGuardCount: 1,
    });
    await lease.release();
    expect(controller.isPolicyDispatchSuppressed()).toBe(true);
    expect(controller.confirmStartupRecoverySafe(recoveryCapability)).toMatchObject({
      capability: recoveryCapability,
      startupRecoverySafe: true,
    });
    expect(controller.isPolicyDispatchSuppressed()).toBe(false);
  });

  it('rejects shutdown with DRAIN_TIMEOUT while an admitted execution still owns the save boundary', async () => {
    const harness = createHarness();
    const running = harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    await harness.page.afterScreenshotStarted;

    const shutdown = harness.service.prepareForShutdown(10);
    try {
      await expect(shutdown).rejects.toMatchObject({
        name: 'ExecutionAuthorityShutdownError',
        code: 'DRAIN_TIMEOUT',
      });
      expect(harness.executionRepository.getExecutionBatch(harness.context, harness.batchId))
        .toEqual(expect.objectContaining({
          batch: expect.objectContaining({ status: 'unknown' }),
          jobs: [expect.objectContaining({ status: 'unknown' })],
        }));
    } finally {
      harness.page.allowAfterScreenshot();
      await running.catch(() => undefined);
    }
  });

  it('waits for the exact admitted execution to settle before reporting a successful drain', async () => {
    const harness = createHarness();
    const running = harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    await harness.page.afterScreenshotStarted;

    let shutdownSettled = false;
    const shutdown = harness.service.prepareForShutdown(1_000);
    void shutdown.then(
      () => { shutdownSettled = true; },
      () => { shutdownSettled = true; },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    harness.page.allowAfterScreenshot();
    await running;
    await expect(shutdown).resolves.toBeUndefined();
    expect(shutdownSettled).toBe(true);
  });

  it('removes a rejected policy dispatch lane before reporting the shutdown drain complete', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    const appendDispatchEvent = harness.executionRepository.appendPolicyGrantDispatchEvent
      .bind(harness.executionRepository);
    let rejectSettledLaneWrite = false;
    const appendSpy = vi.spyOn(harness.executionRepository, 'appendPolicyGrantDispatchEvent')
      .mockImplementation((context, input) => {
        if (rejectSettledLaneWrite) throw new Error('injected settled policy lane rejection');
        return appendDispatchEvent(context, input);
      });

    harness.page.pauseBeforePermit = true;
    const dispatching = harness.service.enqueuePolicyGrant(harness.context, grant);
    await harness.page.prepareSaveReady;
    const shutdown = harness.service.prepareForShutdown(1_000);
    rejectSettledLaneWrite = true;
    harness.page.allowPermitCheck();

    await expect(dispatching).rejects.toThrow('injected settled policy lane rejection');
    appendSpy.mockRestore();
    await expect(shutdown).resolves.toBeUndefined();
    expect(() => harness.service.assertStoreMutationAllowed(harness.context)).not.toThrow();
  });

  it('keeps external-write admission closed across repeated successful shutdown calls', async () => {
    const harness = createHarness();

    await expect(harness.service.prepareForShutdown(10)).resolves.toBeUndefined();
    await expect(harness.service.prepareForShutdown(10)).resolves.toBeUndefined();

    expect(() => harness.service.createBatch({
      context: harness.context,
      grantId: 'grant-1',
    })).toThrow('应用正在退出，禁止启动新的外部写入。');
    await expect(harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    })).rejects.toThrow('应用正在退出，禁止启动新的外部写入。');
  });

  it('persists a missing runtime and resumes the same policy grant once after session readiness', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      runtimeReady: false,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'RUNTIME_UNAVAILABLE',
      batchJobCount: 0,
    });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 0 });

    harness.setRuntimeReady(true);
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    const completed = harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]!;
    expect(completed).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      code: 'EXECUTION_TERMINAL',
      batchJobCount: 1,
      batchStatus: 'succeeded',
    });
    expect(harness.page.clickCount).toBe(1);

    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.page.clickCount).toBe(1);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
  });

  it('journals a policy grant while Amazon Ads is offline before any browser side effect', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      adsReady: false,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'RUNTIME_UNAVAILABLE',
      batchJobCount: 0,
    });
    expect(harness.page.clickCount).toBe(0);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM causal_events
      WHERE store_id = 'store-one'
        AND entity_type = 'policy_grant_dispatch_v1'
        AND entity_id = 'grant-1'
    `).get()).toEqual({ count: 3 });
  });

  it('resumes the same created-but-not-started policy batch after startup recovery', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    const created = harness.executionRepository.createExactExecutionBatch(
      harness.context,
      'grant-1',
    ).projection;
    expect(harness.missionRepository.getMissionLineage(harness.context, 'mission-1').links
      .filter((link) => (
        link.linkType === 'execution'
        && link.targetId === created.batch.id
        && link.relation === 'authorized_execution_batch'
      ))).toEqual([]);
    harness.page.allowAfterScreenshot();

    harness.service.recoverStartup();
    await vi.waitFor(() => {
      expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]?.status)
        .toBe('completed');
    });

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 1,
      batchId: created.batch.id,
      batchStatus: 'succeeded',
      code: 'EXECUTION_TERMINAL',
    });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
    expect(harness.missionRepository.getMissionLineage(harness.context, 'mission-1').links
      .filter((link) => (
        link.linkType === 'execution'
        && link.targetId === created.batch.id
        && link.relation === 'authorized_execution_batch'
      ))).toHaveLength(1);
  });

  it('repairs a missing execution link for a terminal grant without starting its batch', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    const created = harness.executionRepository.createExactExecutionBatch(
      harness.context,
      'grant-1',
    ).projection;
    harness.database.prepare(`
      INSERT INTO mission_grant_events (
        id, store_id, grant_id, event_type, actor_id, reason, created_at
      ) VALUES (
        'grant-terminal-before-link-recovery', 'store-one', 'grant-1', 'revoked',
        'policy-engine', 'grant closed before lineage recovery', ?
      )
    `).run(NOW);

    harness.service.recoverStartup();
    await Promise.resolve();

    const matchingLinks = () => harness.missionRepository
      .getMissionLineage(harness.context, 'mission-1').links
      .filter((link) => (
        link.linkType === 'execution'
        && link.targetId === created.batch.id
        && link.relation === 'authorized_execution_batch'
      ));
    expect(matchingLinks()).toHaveLength(1);
    expect(harness.page.clickCount).toBe(0);
    expect(harness.executionRepository.getExecutionBatch(harness.context, created.batch.id)?.batch.status)
      .toBe('queued');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'attention_required',
      code: 'GRANT_TERMINAL',
      batchId: created.batch.id,
    });

    harness.service.reconcileActiveStore(harness.context);
    expect(matchingLinks()).toHaveLength(1);
    expect(harness.page.clickCount).toBe(0);
  });

  it('resumes a partially succeeded policy batch and runs only its untouched action', async () => {
    const harness = createHarness(2, {
      policyGrant: true,
      createBatch: false,
    });
    const created = harness.executionRepository.createExactExecutionBatch(
      harness.context,
      'grant-1',
    ).projection;
    driveFirstJobToSuccess(harness, created.batch.id);
    expect(harness.executionRepository.getExecutionBatch(harness.context, created.batch.id)?.jobs
      .map((job) => job.status)).toEqual(['succeeded', 'queued']);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toBeUndefined();
    harness.page.allowAfterScreenshot();

    harness.service.recoverStartup();
    await vi.waitFor(() => {
      expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]?.status)
        .toBe('completed');
    });

    const completed = harness.executionRepository.getExecutionBatch(
      harness.context,
      created.batch.id,
    )!;
    expect(completed.batch.status).toBe('succeeded');
    expect(completed.jobs.map((job) => job.status)).toEqual(['succeeded', 'succeeded']);
    expect(harness.page.clickCount).toBe(1);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toEqual(expect.objectContaining({ eventType: 'consumed' }));
  });

  it('retries a start failure only while the existing policy batch is still pre-intent', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
    });
    harness.setBringToFrontError(new Error(
      'browser unavailable Bearer secret-token cookie=session@example.test profile_id=private-profile',
    ));
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    const waiting = harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]!;
    expect(waiting).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'EXECUTION_RETRY_SCHEDULED',
      batchStatus: 'queued',
      batchJobStatuses: ['queued'],
      batchHasPersistedIntent: false,
    });
    expect(waiting.nextRetryAt).toBe('2026-07-23T02:00:01.000Z');
    expect(timer.activeCount()).toBe(1);
    const persistedSignals = harness.database.prepare(`
      SELECT signal FROM causal_events
      WHERE store_id = 'store-one'
        AND entity_type = 'policy_grant_dispatch_v1'
        AND entity_id = 'grant-1'
    `).all() as Array<{ signal: string }>;
    expect(persistedSignals.every(({ signal }) => (
      !signal.includes('secret-token')
      && !signal.includes('session@example.test')
      && !signal.includes('private-profile')
    ))).toBe(true);

    harness.setBringToFrontError(undefined);
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');

    expect(harness.page.clickCount).toBe(1);
    expect(timer.activeCount()).toBe(0);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      code: 'EXECUTION_TERMINAL',
      batchStatus: 'succeeded',
    });
  });

  it('waits and retries when adapter preflight loses the visible browser before intent', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
    });
    harness.page.inputValueError = new Error('browser disconnected during preflight');
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      code: 'EXECUTION_RETRY_SCHEDULED',
      batchStatus: 'preflight',
      batchJobStatuses: ['preflight'],
      batchHasPersistedIntent: false,
    });
    expect(harness.page.clickCount).toBe(0);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toBeUndefined();

    harness.page.inputValueError = undefined;
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      batchStatus: 'succeeded',
    });
  });

  it('waits when the final lease permit expires before intent and succeeds after reacquiring it', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
    });
    harness.page.pauseBeforePermit = true;
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    const dispatching = harness.service.enqueuePolicyGrant(harness.context, grant);
    await harness.page.prepareSaveReady;
    harness.setNow('2026-07-23T03:01:00.000Z');
    harness.page.allowPermitCheck();

    await dispatching;
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      code: 'EXECUTION_RETRY_SCHEDULED',
      batchStatus: 'preflight',
      batchJobStatuses: ['preflight'],
      batchHasPersistedIntent: false,
      nextRetryAt: '2026-07-23T03:01:01.000Z',
    });
    expect(harness.page.clickCount).toBe(0);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toBeUndefined();

    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      batchStatus: 'succeeded',
    });
  });

  it('serializes two policy grants for the same store through one durable lane', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    seedSecondSameStorePolicyGrant(harness.database);
    registerSecondIdentity(harness);
    const firstGrant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    const secondGrant = harness.missionRepository.getMissionGrant(harness.context, 'grant-2')!;

    const first = harness.service.enqueuePolicyGrant(harness.context, firstGrant);
    await harness.page.afterScreenshotStarted;
    const second = harness.service.enqueuePolicyGrant(harness.context, secondGrant);
    await Promise.resolve();

    expect(harness.page.clickCount).toBe(1);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-2'
    `).get()).toEqual({ count: 0 });

    harness.page.allowAfterScreenshot();
    await Promise.all([first, second]);

    expect(harness.page.clickCount).toBe(2);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          grantId: 'grant-1',
          status: 'completed',
          batchStatus: 'succeeded',
        }),
        expect.objectContaining({
          grantId: 'grant-2',
          status: 'completed',
          batchStatus: 'succeeded',
        }),
      ]));
  });

  it('retries a closed policy window from its persisted timer without another user event', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      executionWindow: {
        timeZone: 'America/Los_Angeles',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        start: '00:00',
        end: '00:30',
      },
      policyDispatchRetryMs: 5 * 60 * 60 * 1_000,
      policyDispatchTimer: timer.timer,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      nextRetryAt: '2026-07-23T07:00:00.000Z',
    });
    expect(timer.setCalls[timer.setCalls.length - 1]?.delayMs)
      .toBe(5 * 60 * 60 * 1_000);

    harness.setNow('2026-07-23T07:00:00.000Z');
    harness.page.allowAfterScreenshot();
    timer.runLatest();
    await vi.waitFor(() => {
      expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]?.status)
        .toBe('completed');
    });

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      code: 'EXECUTION_TERMINAL',
    });
  });

  it('clears policy retry timers on shutdown and ignores a late callback', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      runtimeReady: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    await harness.service.enqueuePolicyGrant(harness.context, grant);
    const before = harness.database.prepare(`
      SELECT COUNT(*) AS count FROM causal_events
      WHERE store_id = 'store-one' AND entity_type = 'policy_grant_dispatch_v1'
    `).get() as { count: number };
    expect(timer.activeCount()).toBe(1);

    await harness.service.prepareForShutdown(10);
    expect(timer.activeCount()).toBe(0);
    expect(timer.cleared).toHaveLength(1);

    timer.forceRunLatest();
    await Promise.resolve();
    expect(harness.page.clickCount).toBe(0);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one'
    `).get()).toEqual({ count: 0 });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM causal_events
      WHERE store_id = 'store-one' AND entity_type = 'policy_grant_dispatch_v1'
    `).get()).toEqual(before);
  });

  it('surfaces a terminal pre-batch policy grant as attention-required without identity work', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
    });
    harness.database.prepare(`
      INSERT INTO mission_grant_events (
        id, store_id, grant_id, event_type, actor_id, reason, created_at
      ) VALUES (
        'grant-revoked-before-dispatch', 'store-one', 'grant-1', 'revoked',
        'policy-engine', 'authority changed before dispatch', ?
      )
    `).run(NOW);
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'attention_required',
      code: 'GRANT_TERMINAL',
      batchJobCount: 0,
    });
    expect(harness.executionRepository.listCanonicalKeywordIdentities(harness.context)).toEqual([]);
    expect(harness.page.clickCount).toBe(0);
  });

  it('never restarts an existing UNKNOWN policy batch during startup or session recovery', async () => {
    const harness = createHarness(1, { policyGrant: true });
    harness.page.clickError = new Error('browser disconnected during save');
    const unknown = await harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    expect(unknown.batch.status).toBe('unknown');
    expect(harness.page.clickCount).toBe(1);

    harness.page.clickError = undefined;
    harness.service.recoverStartup();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      batchId: harness.batchId,
      batchStatus: 'unknown',
      code: 'EXECUTION_STATE_REQUIRES_RECONCILIATION',
    });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
  });
});

function createCapsule(directory: string, context: StoreContextEnvelope): StoreCapsulePaths {
  return ensureStoreCapsulePaths(deriveStoreCapsulePaths(
    path.join(directory, 'trusted-stores'),
    context.storeId,
    context.browserProfileId,
  ));
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class FakePolicyDispatchTimer {
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

function driveFirstJobToSuccess(harness: Harness, batchId: string): void {
  const initial = harness.executionRepository.getExecutionBatch(harness.context, batchId)!;
  const job = initial.jobs[0]!;
  const started = harness.executionRepository.startJob(harness.context, {
    jobId: job.id,
    expectedRevision: job.revision,
  });
  const preflight = harness.executionRepository.recordPreflight(harness.context, {
    jobId: job.id,
    expectedRevision: started.job.revision,
    observedBidCents: job.expectedBidCents,
    pageIdentityHash: job.pageIdentityHash,
    canonicalKeywordId: job.canonicalKeywordId,
    objectRevision: job.identity.objectRevision,
  });
  const evidence = (observedBidCents: number, artifactRef: string) => ({
    artifactRef,
    contentSha256: '9'.repeat(64),
    pageIdentityHash: job.pageIdentityHash,
    canonicalKeywordId: job.canonicalKeywordId,
    objectRevision: job.identity.objectRevision,
    observedBidCents,
    capturedAt: NOW,
  });
  const intent = harness.executionRepository.recordSubmitIntent(harness.context, {
    jobId: job.id,
    expectedRevision: preflight.job.revision,
    submitIntentId: 'submit-intent-partial-success',
    commandFingerprint: '5'.repeat(64),
    before: evidence(job.expectedBidCents, 'partial-before-proof'),
  });
  const submitted = harness.executionRepository.recordSubmitted(harness.context, {
    jobId: job.id,
    expectedRevision: intent.job.revision,
  });
  const after = harness.executionRepository.recordAfterEvidence(harness.context, {
    jobId: job.id,
    expectedRevision: submitted.job.revision,
    evidence: evidence(job.targetBidCents, 'partial-after-proof'),
  });
  harness.executionRepository.recordReloadVerified(harness.context, {
    jobId: job.id,
    expectedRevision: after.job.revision,
    evidence: evidence(job.targetBidCents, 'partial-reload-proof'),
  });
}

function seedSecondSameStorePolicyGrant(database: Database.Database): void {
  database.prepare(`
    INSERT INTO missions (
      id, store_id, marketplace, currency, business_date, created_session_generation,
      data_batch_id, policy_version_id, title, objective, status, phase, priority,
      observation_starts_at, observation_ends_at, success_criteria_json,
      guardrails_json, revision, created_at, updated_at
    )
    SELECT 'mission-2', store_id, marketplace, currency, business_date,
      created_session_generation, data_batch_id, policy_version_id,
      'Lower second keyword bid', objective, status, phase, priority,
      observation_starts_at, observation_ends_at, success_criteria_json,
      guardrails_json, revision, created_at, updated_at
    FROM missions WHERE store_id = 'store-one' AND id = 'mission-1'
  `).run();
  database.prepare(`
    INSERT INTO analysis_evidence_packages (
      id, store_id, marketplace, currency, mission_id, data_batch_id, import_run_id,
      date_from, date_to, asin, report_types_json, sources_json, metric_row_count,
      reconciliation_hash, rule_revision, model_revision, package_hash, imported_at,
      fresh_until, sealed_at, created_session_generation
    )
    SELECT 'evidence-2', store_id, marketplace, currency, 'mission-2',
      data_batch_id, import_run_id, date_from, date_to, asin, report_types_json, sources_json,
      metric_row_count, reconciliation_hash, rule_revision, model_revision, ?,
      imported_at, fresh_until, sealed_at, created_session_generation
    FROM analysis_evidence_packages
    WHERE store_id = 'store-one' AND id = 'evidence-1'
  `).run('a'.repeat(64));
  database.prepare(`
    INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type,
      entity_name, campaign_name, ad_group_name, evidence_package_id,
      source_report_type, source_file_hash, source_row, identity_source,
      proof_sha256, verified_by, verified_at, created_at
    )
    SELECT 'stage5-authority-2', store_id, 'opaque-keyword-2', entity_revision,
      entity_type, 'window lock', 'Campaign B', 'Ad Group B', 'evidence-2',
      source_report_type, ?, source_row + 1, identity_source, ?, verified_by,
      verified_at, created_at
    FROM verified_ad_entity_authority
    WHERE store_id = 'store-one' AND authority_id = 'stage5-authority-1'
  `).run('2'.repeat(64), '3'.repeat(64));
  database.prepare(`
    INSERT INTO analysis_action_batches (
      id, store_id, mission_id, mission_revision, evidence_package_id,
      rule_revision, model_revision, action_revision, created_at,
      created_session_generation
    )
    SELECT 'analysis-batch-2', store_id, 'mission-2', mission_revision,
      'evidence-2', rule_revision, model_revision, action_revision, created_at,
      created_session_generation
    FROM analysis_action_batches
    WHERE store_id = 'store-one' AND id = 'analysis-batch-1'
  `).run();
  database.prepare(`
    INSERT INTO analysis_proposal_snapshots (
      id, store_id, marketplace, currency, mission_id, mission_revision,
      evidence_package_id, evidence_package_hash, data_batch_id, policy_version_id,
      policy_revision, rule_revision, model_revision, action_batch_id, action_revision,
      legacy_recommendation_id, action_type, entity_type, entity_name, campaign_name,
      ad_group_name, ad_entity_authority_id, ad_entity_id, ad_entity_revision,
      current_bid_cents, proposed_bid_cents, change_pct, confidence, source,
      explanation, authorization_json, valid_until, created_at,
      created_session_generation
    )
    SELECT 'proposal-mission-2', store_id, marketplace, currency, 'mission-2',
      mission_revision, 'evidence-2', ?, data_batch_id, policy_version_id,
      policy_revision, rule_revision, model_revision, 'analysis-batch-2',
      action_revision, 2, action_type, entity_type, 'window lock', 'Campaign B',
      'Ad Group B', 'stage5-authority-2', 'opaque-keyword-2', ad_entity_revision,
      200, 190, -5, confidence, source, 'lower second inefficient bid',
      authorization_json, valid_until, created_at, created_session_generation
    FROM analysis_proposal_snapshots
    WHERE store_id = 'store-one' AND id = 'proposal-1'
  `).run('a'.repeat(64));
  database.prepare(`
    INSERT INTO decisions (
      id, store_id, mission_id, data_batch_id, policy_version_id, policy_revision,
      action_revision, title, rationale, recommendation, facts_json,
      alternatives_json, valid_until, action_type, ad_entity_id,
      current_value_json, recommended_value_json, confidence, status, revision,
      created_at, updated_at
    )
    SELECT 'decision-mission-2', store_id, 'mission-2', data_batch_id,
      policy_version_id, policy_revision, action_revision,
      'Lower second keyword bid', rationale, recommendation, facts_json,
      alternatives_json, valid_until, action_type, 'opaque-keyword-2',
      '2.00', '1.90', confidence, status, revision, created_at, updated_at
    FROM decisions
    WHERE store_id = 'store-one' AND id = 'decision-1'
  `).run();
  database.prepare(`
    INSERT INTO analysis_proposal_decision_links (
      id, store_id, proposal_id, decision_id, created_at
    )
    SELECT 'proposal-link-mission-2', store_id, 'proposal-mission-2',
      'decision-mission-2', created_at
    FROM analysis_proposal_decision_links
    WHERE store_id = 'store-one' AND id = 'proposal-link-1'
  `).run();
  database.prepare(`
    INSERT INTO mission_grants (
      id, store_id, marketplace, currency, mission_id, mission_revision,
      decision_ids_json, action_revision, allowed_action_types_json,
      allowed_ad_entity_ids_json, max_change_pct, total_impact_budget, expires_at,
      policy_version_id, policy_revision, required_evidence_json,
      stop_conditions_json, issuer_type, issuer_actor_id, issued_at,
      created_session_generation
    )
    SELECT 'grant-2', store_id, marketplace, currency, 'mission-2',
      mission_revision, '["decision-mission-2"]', action_revision,
      allowed_action_types_json, '["opaque-keyword-2"]', max_change_pct,
      total_impact_budget, expires_at, policy_version_id, policy_revision,
      required_evidence_json, stop_conditions_json, 'policy', 'policy-engine',
      issued_at, created_session_generation
    FROM mission_grants
    WHERE store_id = 'store-one' AND id = 'grant-1'
  `).run();
  database.prepare(`
    INSERT INTO mission_grant_events (
      id, store_id, grant_id, event_type, actor_id, created_at
    ) VALUES (
      'grant-event-mission-2', 'store-one', 'grant-2', 'issued',
      'policy-engine', ?
    )
  `).run(NOW);
}

function registerSecondIdentity(harness: Harness): void {
  harness.executionRepository.registerCanonicalKeywordIdentity(harness.context, {
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
      keyword: {
        keywordId: 'keyword-2',
        adGroupId: 'ad-group-2',
        bidCents: 200,
      },
    }),
    resolutionProofSha256: '6'.repeat(64),
    resolvedAt: NOW,
    resolvedBy: 'operator',
  });
}

function seedAuthority(
  database: Database.Database,
  actionCount = 1,
  issuerType: 'human' | 'policy' = 'human',
  executionWindow: {
    timeZone: 'America/Los_Angeles';
    daysOfWeek: number[];
    start: string;
    end: string;
  } = {
    timeZone: 'America/Los_Angeles',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    start: '00:00',
    end: '23:59',
  },
): void {
  const rules = {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: actionCount > 1
      ? ['opaque-keyword-1', 'opaque-keyword-2']
      : ['opaque-keyword-1'],
    maxChangePct: 10, totalImpactBudget: 10, maxDailyActionCount: 10, cooldownMinutes: 0,
    executionWindow,
    requiredEvidence: ['page_identity', 'before_screenshot', 'after_screenshot', 'reload_screenshot', 'readback_value'],
    stopConditions: [{ code: 'unknown_result', detail: 'stop' }, { code: 'kill_switch', detail: 'stop' }],
    killSwitch: false,
  };
  database.prepare(`INSERT INTO stores (
    store_id, browser_profile_id, marketplace, currency, display_name, status,
    business_timezone, created_at, updated_at
  ) VALUES ('store-one', 'profile-one', 'US', 'USD', 'US Store One', 'active',
    'America/Los_Angeles', ?, ?)`
  ).run(NOW, NOW);
  database.prepare(`INSERT INTO app_settings (key, value, updated_at)
    VALUES ('store_session_generation:store-one', '4', ?)`
  ).run(NOW);
  database.prepare(`INSERT INTO store_connections (
    id, store_id, provider, status, account_label, external_account_id,
    last_verified_at, created_at, updated_at
  ) VALUES ('conn-ads-one', 'store-one', 'amazon_ads', 'ready', 'Ads One',
    'ads-account-1', ?, ?, ?)`
  ).run(NOW, NOW, NOW);
  database.prepare(`INSERT INTO store_session_metadata (
    store_id, provider, browser_profile_id, status, session_generation,
    observed_at, external_account_id, verified_at, updated_at
  ) VALUES ('store-one', 'amazon_ads', 'profile-one', 'ready', 4,
    ?, 'ads-account-1', ?, ?)`
  ).run(NOW, NOW, NOW);
  database.prepare(`INSERT INTO lingxing_report_batches (
    id, date_start, date_end, store_name, marketplace_code, status, download_dir,
    created_at, completed_at, store_id, request_id, browser_profile_id,
    business_date, session_generation
  ) VALUES ('data-batch-1', '2026-07-01', '2026-07-22', 'US Store One', 'US',
    'completed', 'artifact:data-batch-1', ?, ?, 'store-one', 'request-1',
    'profile-one', '2026-07-22', 4)`
  ).run(NOW, NOW);
  database.prepare(`INSERT INTO policies (
    id, store_id, name, scope, status, priority, active_version_id, revision,
    created_at, updated_at
  ) VALUES ('policy-1', 'store-one', 'Keyword safety', 'store', 'active', 1,
    NULL, 2, ?, ?)`
  ).run(NOW, NOW);
  database.prepare(`INSERT INTO policy_versions (
    id, store_id, policy_id, version, status, rules_json, revision,
    created_at, updated_at, enabled_at
  ) VALUES ('policy-version-1', 'store-one', 'policy-1', 1, 'enabled', ?, 1, ?, ?, ?)`
  ).run(JSON.stringify(rules), NOW, NOW, NOW);
  database.prepare(`UPDATE policies SET active_version_id = 'policy-version-1'
    WHERE id = 'policy-1'`
  ).run();
  database.prepare(`UPDATE policy_runtime SET active_policy_version_id = 'policy-version-1',
    autonomy_mode = ?, updated_at = ? WHERE store_id = 'store-one'`
  ).run(issuerType === 'policy' ? 'policy_auto' : 'manual_approval', NOW);
  database.prepare(`INSERT INTO missions (
    id, store_id, marketplace, currency, business_date, created_session_generation,
    data_batch_id, policy_version_id, title, objective, status, phase, priority,
    observation_starts_at, observation_ends_at, success_criteria_json,
    guardrails_json, revision, created_at, updated_at
  ) VALUES ('mission-1', 'store-one', 'US', 'USD', '2026-07-22', 4,
    'data-batch-1', 'policy-version-1', 'Lower keyword bid', 'Lower ACOS',
    'active', 'decision', 'P1', '2026-07-22T00:00:00.000Z',
    '2026-07-30T00:00:00.000Z', '["ACOS improves"]', '["UNKNOWN stops"]', 1, ?, ?)`
  ).run(NOW, NOW);
  database.prepare(`INSERT INTO report_import_runs (
    store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
    source_file_count, metric_row_count, reconciliation_count, started_at,
    completed_at, created_at
  ) VALUES ('store-one', 'import-run-1', 'import-idem-1', ?, 'data-batch-1',
    'completed', 8, 8, 8, ?, ?, ?)`
  ).run('c'.repeat(64), NOW, NOW, NOW);
  database.prepare(`INSERT INTO analysis_evidence_packages (
    id, store_id, marketplace, currency, mission_id, data_batch_id, import_run_id,
    date_from, date_to, report_types_json, sources_json, metric_row_count,
    reconciliation_hash, rule_revision, model_revision, package_hash, imported_at,
    fresh_until, sealed_at, created_session_generation
  ) VALUES ('evidence-1', 'store-one', 'US', 'USD', 'mission-1', 'data-batch-1',
    'import-run-1', '2026-07-01', '2026-07-22', '[]', '[]', 8, ?, ?,
    'model-1', ?, ?, '2026-07-24T00:00:00.000Z', ?, 4)`
  ).run('d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), NOW, NOW);
  database.prepare(`INSERT INTO verified_ad_entity_authority (
    authority_id, store_id, ad_entity_id, entity_revision, entity_type, entity_name,
    campaign_name, ad_group_name, evidence_package_id, source_report_type,
    source_file_hash, source_row, identity_source, proof_sha256, verified_by,
    verified_at, created_at
  ) VALUES ('stage5-authority-1', 'store-one', 'opaque-keyword-1', 1, 'keyword',
    'door lock', 'Campaign A', 'Ad Group A', 'evidence-1', 'keyword', ?, 7,
    'ads_ui', ?, 'operator', ?, ?)`
  ).run('1'.repeat(64), 'b'.repeat(64), NOW, NOW);
  database.prepare(`INSERT INTO analysis_action_batches (
    id, store_id, mission_id, mission_revision, evidence_package_id, rule_revision,
    model_revision, action_revision, created_at, created_session_generation
  ) VALUES ('analysis-batch-1', 'store-one', 'mission-1', 1, 'evidence-1', ?,
    'model-1', 1, ?, 4)`
  ).run('e'.repeat(64), NOW);
  database.prepare(`INSERT INTO analysis_proposal_snapshots (
    id, store_id, marketplace, currency, mission_id, mission_revision,
    evidence_package_id, evidence_package_hash, data_batch_id, policy_version_id,
    policy_revision, rule_revision, model_revision, action_batch_id, action_revision,
    legacy_recommendation_id, action_type, entity_type, entity_name, campaign_name,
    ad_group_name, ad_entity_authority_id, ad_entity_id, ad_entity_revision,
    current_bid_cents, proposed_bid_cents, change_pct, confidence, source,
    explanation, authorization_json, valid_until, created_at, created_session_generation
  ) VALUES ('proposal-1', 'store-one', 'US', 'USD', 'mission-1', 1,
    'evidence-1', ?, 'data-batch-1', 'policy-version-1', 1, ?, 'model-1',
    'analysis-batch-1', 1, 1, 'set_keyword_bid', 'keyword', 'door lock',
    'Campaign A', 'Ad Group A', 'stage5-authority-1', 'opaque-keyword-1', 1,
    149, 139, -6.7114093959731544, 0.9, 'rule_ai', 'lower inefficient bid',
    ?, '2026-07-24T00:00:00.000Z', ?, 4)`
  ).run('f'.repeat(64), 'e'.repeat(64), JSON.stringify({ human: { eligible: true, blockers: [] }, policy: { eligible: true, blockers: [] } }), NOW);
  database.prepare(`INSERT INTO decisions (
    id, store_id, mission_id, data_batch_id, policy_version_id, policy_revision,
    action_revision, title, rationale, recommendation, facts_json, alternatives_json,
    valid_until, action_type, ad_entity_id, current_value_json,
    recommended_value_json, confidence, status, revision, created_at, updated_at
  ) VALUES ('decision-1', 'store-one', 'mission-1', 'data-batch-1',
    'policy-version-1', 1, 1, 'Lower door lock bid', 'High ACOS', 'Lower bid',
    '["fact"]', '["keep"]', '2026-07-24T00:00:00.000Z', 'set_keyword_bid',
    'opaque-keyword-1', '1.49', '1.39', 0.9, 'approved', 2, ?, ?)`
  ).run(NOW, NOW);
  database.prepare(`INSERT INTO analysis_proposal_decision_links (
    id, store_id, proposal_id, decision_id, created_at
  ) VALUES ('proposal-link-1', 'store-one', 'proposal-1', 'decision-1', ?)`
  ).run(NOW);
  if (actionCount > 1) {
    database.prepare(`INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type, entity_name,
      campaign_name, ad_group_name, evidence_package_id, source_report_type,
      source_file_hash, source_row, identity_source, proof_sha256, verified_by,
      verified_at, created_at
    ) VALUES ('stage5-authority-2', 'store-one', 'opaque-keyword-2', 1, 'keyword',
      'window lock', 'Campaign B', 'Ad Group B', 'evidence-1', 'keyword', ?, 8,
      'ads_ui', ?, 'operator', ?, ?)`
    ).run('2'.repeat(64), '3'.repeat(64), NOW, NOW);
    database.prepare(`INSERT INTO analysis_proposal_snapshots (
      id, store_id, marketplace, currency, mission_id, mission_revision,
      evidence_package_id, evidence_package_hash, data_batch_id, policy_version_id,
      policy_revision, rule_revision, model_revision, action_batch_id, action_revision,
      legacy_recommendation_id, action_type, entity_type, entity_name, campaign_name,
      ad_group_name, ad_entity_authority_id, ad_entity_id, ad_entity_revision,
      current_bid_cents, proposed_bid_cents, change_pct, confidence, source,
      explanation, authorization_json, valid_until, created_at, created_session_generation
    ) VALUES ('proposal-2', 'store-one', 'US', 'USD', 'mission-1', 1,
      'evidence-1', ?, 'data-batch-1', 'policy-version-1', 1, ?, 'model-1',
      'analysis-batch-1', 1, 2, 'set_keyword_bid', 'keyword', 'window lock',
      'Campaign B', 'Ad Group B', 'stage5-authority-2', 'opaque-keyword-2', 1,
      200, 190, -5, 0.9, 'rule_ai', 'lower inefficient bid', ?,
      '2026-07-24T00:00:00.000Z', ?, 4)`
    ).run(
      'f'.repeat(64),
      'e'.repeat(64),
      JSON.stringify({ human: { eligible: true, blockers: [] }, policy: { eligible: true, blockers: [] } }),
      NOW,
    );
    database.prepare(`INSERT INTO decisions (
      id, store_id, mission_id, data_batch_id, policy_version_id, policy_revision,
      action_revision, title, rationale, recommendation, facts_json, alternatives_json,
      valid_until, action_type, ad_entity_id, current_value_json,
      recommended_value_json, confidence, status, revision, created_at, updated_at
    ) VALUES ('decision-2', 'store-one', 'mission-1', 'data-batch-1',
      'policy-version-1', 1, 1, 'Lower window lock bid', 'High ACOS', 'Lower bid',
      '["fact"]', '["keep"]', '2026-07-24T00:00:00.000Z', 'set_keyword_bid',
      'opaque-keyword-2', '2.00', '1.90', 0.9, 'approved', 2, ?, ?)`
    ).run(NOW, NOW);
    database.prepare(`INSERT INTO analysis_proposal_decision_links (
      id, store_id, proposal_id, decision_id, created_at
    ) VALUES ('proposal-link-2', 'store-one', 'proposal-2', 'decision-2', ?)`
    ).run(NOW);
  }
  const decisionIds = actionCount > 1 ? '["decision-1","decision-2"]' : '["decision-1"]';
  const adEntityIds = actionCount > 1
    ? '["opaque-keyword-1","opaque-keyword-2"]'
    : '["opaque-keyword-1"]';
  database.prepare(`INSERT INTO mission_grants (
    id, store_id, marketplace, currency, mission_id, mission_revision,
    decision_ids_json, action_revision, allowed_action_types_json,
    allowed_ad_entity_ids_json, max_change_pct, total_impact_budget, expires_at,
    policy_version_id, policy_revision, required_evidence_json, stop_conditions_json,
    issuer_type, issuer_actor_id, issued_at, created_session_generation
  ) VALUES ('grant-1', 'store-one', 'US', 'USD', 'mission-1', 1,
    ?, 1, '["set_keyword_bid"]', ?,
    10, 10, '2026-07-24T00:00:00.000Z', 'policy-version-1', 1, ?, ?,
    ?, ?, ?, 4)`
  ).run(
    decisionIds,
    adEntityIds,
    JSON.stringify(rules.requiredEvidence),
    JSON.stringify(rules.stopConditions),
    issuerType,
    issuerType === 'policy' ? 'policy-engine' : 'operator',
    NOW,
  );
  database.prepare(`INSERT INTO mission_grant_events (
    id, store_id, grant_id, event_type, actor_id, created_at
  ) VALUES ('grant-event-1', 'store-one', 'grant-1', 'issued', 'operator', ?)`
  ).run(NOW);
}
