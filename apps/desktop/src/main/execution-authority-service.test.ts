import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { ExecutionAuthorityService } from './execution-authority-service';

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

  async inputValue(): Promise<string> { return this.kind === 'bid' ? this.page.bidValue : ''; }
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
    if (selector === `input.select-item[value="${this.keywordId}"]`) return new FakeLocator(this, 'marker');
    return new FakeLocator(this, 'missing');
  }

  selectCampaign(campaignId: string): void {
    this.campaignId = campaignId;
    const second = campaignId === 'campaign-2';
    this.adGroupId = second ? 'ad-group-2' : 'ad-group-1';
    this.keywordId = second ? 'keyword-2' : 'keyword-1';
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
}

function createHarness(actionCount = 1): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-execution-service-'));
  tempDirs.push(directory);
  const database = initSqlite(path.join(directory, 'app.db'));
  databases.push(database);
  seedAuthority(database, actionCount);
  const context = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  const executionRepository = new ExecutionAuthorityRepository(database, { now: () => new Date(NOW) });
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
  if (actionCount > 1) {
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
  const missionRepository = new MissionDomainRepository(database, { now: () => new Date(NOW) });
  const page = new FakeExecutionPage();
  const capsule = createCapsule(directory, context);
  const service = new ExecutionAuthorityService({
    repository: executionRepository,
    missionRepository,
    analysisRepository: new AnalysisAuthorityRepository(database, { now: () => new Date(NOW) }),
    storeCoordinator: {
      assertActiveStoreContext: (input) => {
        expect(input).toEqual(context);
        return context;
      },
      getActiveStoreContext: () => context,
    },
    leases: new BrowserLeaseManager(() => new Date(NOW).getTime(), () => 'stage6-lease-token-0001'),
    resolveBrowserRuntime: () => ({
      context,
      externalAccountId: 'ads-account-1',
      page,
      capsule,
      navigate: async (url) => {
        page.selectCampaign(new URL(url).searchParams.get('id') ?? 'campaign-1');
      },
      bringToFront: async () => undefined,
    }),
    now: () => new Date(NOW),
  });
  const batchId = service.createBatch({ context, grantId: 'grant-1' }).projection.batch.id;
  return { context, database, executionRepository, missionRepository, service, page, batchId };
}

describe('ExecutionAuthorityService safety orchestration', () => {
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

function seedAuthority(database: Database.Database, actionCount = 1): void {
  const rules = {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: actionCount > 1
      ? ['opaque-keyword-1', 'opaque-keyword-2']
      : ['opaque-keyword-1'],
    maxChangePct: 10, totalImpactBudget: 10, maxDailyActionCount: 10, cooldownMinutes: 0,
    executionWindow: { timeZone: 'America/Los_Angeles', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' },
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
    updated_at = ? WHERE store_id = 'store-one'`
  ).run(NOW);
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
    'human', 'operator', ?, 4)`
  ).run(
    decisionIds,
    adEntityIds,
    JSON.stringify(rules.requiredEvidence),
    JSON.stringify(rules.stopConditions),
    NOW,
  );
  database.prepare(`INSERT INTO mission_grant_events (
    id, store_id, grant_id, event_type, actor_id, created_at
  ) VALUES ('grant-event-1', 'store-one', 'grant-1', 'issued', 'operator', ?)`
  ).run(NOW);
}
