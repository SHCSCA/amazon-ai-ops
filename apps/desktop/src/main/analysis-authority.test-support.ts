// Isolated database fixture; external report/AI inputs here are test data, never L6/L7 evidence.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisAuthorityRepository,
  MissionDomainRepository,
  RecommendationRepository,
  initSqlite,
} from '@amazon-ai-ops/local-db';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  normalizeStoreContextEnvelope,
  type ActionRecommendation,
  type PolicyVersionRules,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  AnalysisAuthorityService,
  DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS,
  type AnalysisAuthorityServiceOptions,
  type AnalysisRecommendationGenerationScope,
  type CapturedAnalysisGenerationAuthority,
} from './analysis-authority-service';

export const NOW = '2026-07-22T12:00:00.000Z';
export const RULE_REVISION = 'a'.repeat(64);
export const tempDirs: string[] = [];
export const databases: Database.Database[] = [];
const pendingHarnessImports: Array<Promise<{ error?: unknown }>> = [];

afterEach(async () => {
  const imports = await Promise.all(pendingHarnessImports.splice(0));
  while (databases.length > 0) {
    const database = databases.pop();
    if (database?.open) database.close();
  }
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
  const failures = imports.flatMap(result => result.error === undefined ? [] : [result.error]);
  if (failures.length) throw new AggregateError(failures, 'HARNESS_REJECTED_ASYNC_IMPORT_FAILED');
});

export interface Harness {
  directory: string;
  database: Database.Database;
  context: StoreContextEnvelope;
  analysisRepository: AnalysisAuthorityRepository;
  missionRepository: MissionDomainRepository;
  recommendationRepository: RecommendationRepository;
  service: AnalysisAuthorityService;
  missionId: string;
  policyVersionId: string;
  proofPath: string;
  ruleRevision: { value: string };
  modelRevision: { value: string };
  recommendationMutation: { count: number };
  generationScopes: AnalysisRecommendationGenerationScope[];
}

export interface AnalysisHarnessOptions {
  autonomyMode?: 'manual_approval' | 'policy_auto';
  withWritableTarget?: boolean;
  fallback?: boolean;
  recommendationCount?: number;
  proofAllowed?: boolean;
  maxDailyActionCount?: number;
  cooldownMinutes?: number;
  executionWindow?: PolicyVersionRules['executionWindow'];
  mutateMissionDuringGeneration?: boolean;
  generationAuthorityFactory?: (
    captured: CapturedAnalysisGenerationAuthority,
  ) => CapturedAnalysisGenerationAuthority;
  onAutomaticGrantIssued?: AnalysisAuthorityServiceOptions['onAutomaticGrantIssued'];
  batchStoreName?: string;
  deduplicateRecommendations?: boolean;
  recommendationEvidencePatch?: Partial<ActionRecommendation['evidence']>;
  generationTimeoutMs?: number;
  importReports?: typeof seedImportAuthority;
  now?: () => Date;
  reportDateEnd?: string;
  policyValidUntil?: string;
}

function finishHarness(steps: Generator<{ database: Database.Database; directory: string }, Harness, Record<string, string>>, paths: Record<string, string>): Harness {
  const result = steps.next(paths);
  if (!result.done) throw new Error('HARNESS_INITIALIZATION_NOT_COMPLETE');
  return result.value;
}
export function createHarness(options: AnalysisHarnessOptions = {}): Harness {
  const steps = createHarnessSteps(options), setup = steps.next();
  if (setup.done) throw new Error('HARNESS_IMPORT_STAGE_MISSING');
  const paths = (options.importReports ?? seedImportAuthority)(setup.value.database, setup.value.directory);
  if (paths && typeof (paths as unknown as PromiseLike<unknown>).then === 'function') {
    pendingHarnessImports.push(Promise.resolve(paths).then(() => ({}), error => ({ error })));
    throw new Error('HARNESS_ASYNC_IMPORT_REQUIRES_ASYNC_ENTRY');
  }
  return finishHarness(steps, paths);
}
export async function createHarnessAsync(options: Omit<AnalysisHarnessOptions, 'importReports'> & {
  importReports: (database: Database.Database, directory: string) => Promise<Record<string, string>>;
}): Promise<Harness> {
  const steps = createHarnessSteps({ ...options, importReports: undefined }), setup = steps.next();
  if (setup.done) throw new Error('HARNESS_IMPORT_STAGE_MISSING');
  // 真实异步导入完成后才初始化依赖其凭证的领域服务；同步夹具沿用同一后半段。
  return finishHarness(steps, await options.importReports(setup.value.database, setup.value.directory));
}
function* createHarnessSteps(options: AnalysisHarnessOptions): Generator<{ database: Database.Database; directory: string }, Harness, Record<string, string>> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-analysis-service-'));
  tempDirs.push(directory);
  const database = initSqlite(path.join(directory, 'app.db'));
  databases.push(database);
  const context = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES ('store-one', 'profile-one', 'US', 'USD', 'US Store One',
      'active', 'America/Los_Angeles', ?, ?)
  `).run(NOW, NOW);
  for (const provider of ['lingxing', 'amazon_ads']) {
    database.prepare(`
      INSERT INTO store_session_metadata (
        store_id, provider, browser_profile_id, status, session_generation,
        observed_at, verified_at, updated_at
      ) VALUES ('store-one', ?, 'profile-one', 'ready', 4, ?, ?, ?)
    `).run(provider, NOW, NOW, NOW);
  }
  database.prepare(`
    INSERT INTO lingxing_report_batches (
      id, date_start, date_end, store_name, marketplace_code, status,
      download_dir, created_at, completed_at, store_id, request_id,
      browser_profile_id, business_date, session_generation
    ) VALUES ('batch-1', '2026-07-01', ?, ?, 'US', 'completed',
      ?, ?, ?, 'store-one', 'request-1', 'profile-one', '2026-07-22', 4)
  `).run(options.reportDateEnd ?? '2026-07-22', options.batchStoreName ?? 'US Store One', path.join(directory, 'reports'), NOW, NOW);

  // Seed a production_full collection job so requireCompletedDataBatch (via
  // createMission) and formalBusinessDataGate (via getBusinessRecommendationGate)
  // both pass with strict 18-condition checks.
  const REQUIRED_COLLECTION_REPORT_TYPES = [
    'campaign', 'ad_group', 'placement', 'advertised_product',
    'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
  ] as const;
  // lingxing_report_batches.request_id below is 'request-1'; productionRootReady
  // requires jobRequestId === persistedRequestId exactly.
  const COLLECTION_REQUEST_ID = 'request-1';
  const COLLECTION_JOB_ID = 'batch-1';
  const collectionJobSnapshot = JSON.stringify({
    jobId: COLLECTION_JOB_ID,
    state: 'completed',
    importState: 'succeeded',
    request: {
      requestId: COLLECTION_REQUEST_ID,
      reportTypes: REQUIRED_COLLECTION_REPORT_TYPES,
    },
    lineage: {
      lineageId: COLLECTION_JOB_ID,
      rootJobId: COLLECTION_JOB_ID,
      parentJobId: undefined,
      purpose: 'production_full',
      expectedReportTypes: REQUIRED_COLLECTION_REPORT_TYPES,
    },
    reports: [],
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
    importCompletedAt: NOW,
  });
  database.prepare(`
    INSERT OR REPLACE INTO lingxing_collection_jobs (
      store_id, job_id, request_id, browser_profile_id, marketplace,
      currency, business_timezone, business_date, session_generation,
      date_start, date_end, mode, report_types_json, state, snapshot_json,
      created_at, updated_at, completed_at
    ) VALUES (
      'store-one', ?, ?, 'profile-one', 'US',
      'USD', 'America/Los_Angeles', '2026-07-22', 4,
      '2026-07-01', ?, 'create-and-download', ?, 'completed', ?,
      ?, ?, ?
    )
  `).run(
    COLLECTION_JOB_ID,
    COLLECTION_REQUEST_ID,
    options.reportDateEnd ?? '2026-07-22',
    JSON.stringify(REQUIRED_COLLECTION_REPORT_TYPES),
    collectionJobSnapshot,
    NOW, NOW, NOW,
  );
  // Seed 8 'downloaded' checkpoints so checkpoint.total/distinctTypes/downloaded
  // all equal 8. attempt_index and auto_retry_count are NOT NULL with CHECK >=0.
  const insertCheckpoint = database.prepare(`
    INSERT OR IGNORE INTO lingxing_collection_report_checkpoints (
      store_id, job_id, report_type, state, attempt_index, auto_retry_count, updated_at
    ) VALUES ('store-one', ?, ?, 'downloaded', 0, 0, ?)
  `);
  for (const reportType of REQUIRED_COLLECTION_REPORT_TYPES) {
    insertCheckpoint.run(COLLECTION_JOB_ID, reportType, NOW);
  }
  const reportPaths = yield { database, directory };
  const proofPath = path.join(directory, 'proof.png');
  fs.writeFileSync(proofPath, Buffer.from('verified visible Ads identity proof'));

  const analysisRepository = new AnalysisAuthorityRepository(database, { now: options.now ?? (() => new Date(NOW)) });
  const missionRepository = new MissionDomainRepository(database, {
    now: options.now ?? (() => new Date(NOW)),
    references: {
      productBelongsToStore: () => true,
      adEntityBelongsToStore: (authorized, adEntityId) => (
        analysisRepository.adEntityBelongsToStore(authorized, adEntityId)
      ),
      adEntitySupportsKeywordBid: (authorized, adEntityId) => {
        const authority = analysisRepository.getLatestVerifiedAdEntityById(authorized, adEntityId);
        return authority?.entityType === 'keyword' && authority.sourceReportType === 'keyword';
      },
    },
  });
  const recommendationRepository = new RecommendationRepository(database);
  const rules: PolicyVersionRules = {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: ['opaque-keyword-1', 'opaque-keyword-2'],
    maxChangePct: 10,
    totalImpactBudget: 100,
    maxDailyActionCount: options.maxDailyActionCount ?? 100,
    cooldownMinutes: options.cooldownMinutes ?? 0,
    executionWindow: options.executionWindow ?? {
      timeZone: 'America/Los_Angeles',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      start: '00:00',
      end: '23:59',
    },
    requiredEvidence: [
      'page_identity', 'before_screenshot', 'after_screenshot',
      'reload_screenshot', 'readback_value',
    ],
    stopConditions: [
      { code: 'identity_drift', detail: 'stop' },
      { code: 'expected_before_mismatch', detail: 'stop' },
      { code: 'unknown_result', detail: 'stop' },
      { code: 'data_stale', detail: 'stop' },
      { code: 'impact_budget_exhausted', detail: 'stop' },
      { code: 'kill_switch', detail: 'stop' },
    ],
    killSwitch: false,
  };
  seedBootstrapPolicyAuthorities({
    database,
    context,
    analysisRepository,
    missionRepository,
    rules,
    entities: [
      { adEntityId: 'opaque-keyword-1', entityName: 'door lock', sourceRow: 7 },
      { adEntityId: 'opaque-keyword-2', entityName: 'door lock 2', sourceRow: 8 },
    ],
  });
  const policy = missionRepository.createPolicy(context, {
    id: 'policy-1',
    name: 'US keyword bid policy',
    scope: 'store',
    priority: 1,
    actorId: 'operator',
  });
  const draftVersion = missionRepository.createPolicyVersion(context, {
    id: 'policy-version-1',
    policyId: policy.id,
    version: 1,
    validUntil: options.policyValidUntil,
    rules,
    actorId: 'operator',
  });
  const policyVersion = missionRepository.enablePolicyVersion(context, {
    policyId: policy.id,
    versionId: draftVersion.id,
    expectedPolicyRevision: policy.revision,
    expectedVersionRevision: draftVersion.revision,
    actorId: 'operator',
  });
  const draftMission = missionRepository.createMission(context, {
    id: 'mission-1',
    dataBatchId: 'batch-1',
    policyVersionId: policyVersion.id,
    productId: 'B0TEST',
    title: 'Reduce inefficient keyword bids',
    objective: 'Improve ACOS while protecting orders',
    observationStartsAt: '2026-07-22T00:00:00.000Z',
    observationEndsAt: '2026-07-29T00:00:00.000Z',
    successCriteria: ['ACOS improves'],
    guardrails: ['Orders remain stable'],
    actorId: 'operator',
  });
  const mission = missionRepository.transitionMission(context, {
    id: draftMission.id,
    expectedRevision: draftMission.revision,
    status: 'active',
    phase: 'analysis',
    actorId: 'operator',
  });
  if (options.autonomyMode === 'policy_auto') {
    const runtime = missionRepository.getPolicyRuntime(context);
    missionRepository.updatePolicyRuntime(context, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: {
        autonomyMode: 'policy_auto',
        activePolicyVersionId: policyVersion.id,
        killSwitch: false,
        circuitBreakerState: 'closed',
      },
    });
  }
  const recommendationCount = options.recommendationCount ?? 1;
  const ruleRevision = { value: RULE_REVISION };
  const modelRevision = { value: 'gpt-5.6:ad_strategy_diagnosis_v1' };
  const recommendationMutation = { count: recommendationCount };
  const generationScopes: AnalysisRecommendationGenerationScope[] = [];
  const deniedProofRoot = path.join(directory, 'denied-proof-root');
  fs.mkdirSync(deniedProofRoot, { recursive: true });
  let generationDelegate: CapturedAnalysisGenerationAuthority['generateRecommendations'] = async () => {
    throw new Error('analysis generation delegate was not initialized');
  };
  const service = new AnalysisAuthorityService({
    db: database,
    repository: analysisRepository,
    missionRepository,
    recommendationRepository,
    storeCoordinator: {
      assertActiveStoreContext(input) {
        expect(input).toEqual(context);
        return context;
      },
    },
    currentRuleRevision: () => ruleRevision.value,
    currentModelRevision: () => modelRevision.value,
    captureGenerationAuthority: () => {
      const captured = Object.freeze({
        ruleRevision: ruleRevision.value,
        modelRevision: modelRevision.value,
        generateRecommendations: generationDelegate,
      });
      return options.generationAuthorityFactory?.(captured) ?? captured;
    },
    allowedProofRoots: () => [options.proofAllowed === false ? deniedProofRoot : directory],
    onAutomaticGrantIssued: options.onAutomaticGrantIssued,
    generationTimeoutMs: options.generationTimeoutMs,
    now: options.now ?? (() => new Date(NOW)),
    generateRecommendations: generationDelegate = async (scope) => {
      scope.signal.throwIfAborted();
      generationScopes.push(scope);
      expect(scope).toMatchObject({
        storeName: 'US Store One',
        marketplaceCode: 'US',
        batchId: 'batch-1',
      });
      const recommendationIds: number[] = [];
      let generated = 0;
      let skippedDuplicates = 0;
      let refreshedDuplicates = 0;
      for (let index = 1; index <= recommendationMutation.count; index += 1) {
        scope.signal.throwIfAborted();
        const entityName = index === 1 ? 'door lock' : `door lock ${index}`;
        const rec = recommendation({
          entityName,
          entityId: `synthetic-${index}`,
          evidence: {
            ...recommendation().evidence,
            targeting: entityName,
            sourceFile: reportPaths.keyword,
            sourceFiles: [reportPaths.keyword],
            sourceRow: 6 + index,
            ...(options.withWritableTarget === false ? { writableTarget: undefined } : {
              writableTarget: {
                ...recommendation().evidence.writableTarget!,
                metricDate: scope.dateTo,
                entityId: `opaque-keyword-${index}`,
                entityName,
                sourceFile: reportPaths.keyword,
                sourceRow: 6 + index,
                identityProofPath: proofPath,
              },
            }),
            ...(options.fallback ? {
              decisionSource: 'rule',
              aiFallbackReason: 'provider unavailable',
            } : {}),
            ...options.recommendationEvidencePatch,
          },
        });
        if (options.deduplicateRecommendations) {
          const persisted = recommendationRepository.insertIfNoDuplicateForStore(context.storeId, rec);
          recommendationIds.push(persisted.id);
          if (persisted.inserted) generated += 1;
          else if (persisted.updated) refreshedDuplicates += 1;
          else skippedDuplicates += 1;
        } else {
          recommendationIds.push(recommendationRepository.insertForStore(context.storeId, rec));
          generated += 1;
        }
      }
      if (options.mutateMissionDuringGeneration) {
        const currentMission = missionRepository.getMission(context, mission.id)!;
        missionRepository.updateMission(context, {
          id: currentMission.id,
          expectedRevision: currentMission.revision,
          actorId: 'operator',
          patch: { title: 'Mission changed while analysis was running' },
        });
      }
      return {
        generated,
        metrics: 8,
        skippedDuplicates,
        refreshedDuplicates,
        recommendationCandidates: recommendationIds.length,
        recommendationIds,
        aiExplanation: {
          configured: !options.fallback,
          invoked: !options.fallback,
          reason: options.fallback ? 'AI unavailable; rule fallback.' : 'AI and rules aligned.',
          model: 'gpt-5.6',
          strategyDiagnosis: { source: options.fallback ? 'rule' : 'ai' },
        },
        scope: {
          storeId: context.storeId,
          storeName: 'US Store One',
          marketplaceCode: 'US',
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          asin: 'B0TEST',
          batchId: 'batch-1',
        },
      };
    },
  });
  return {
    directory,
    database,
    context,
    analysisRepository,
    missionRepository,
    recommendationRepository,
    service,
    missionId: mission.id,
    policyVersionId: policyVersion.id,
    proofPath,
    ruleRevision,
    modelRevision,
    recommendationMutation,
    generationScopes,
  };
}

export function seedImportAuthority(database: Database.Database, directory: string): Record<string, string> {
  const reportDir = path.join(directory, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES ('store-one', 'run-1', 'idem-1', ?, 'batch-1', 'completed',
      8, 9, 8, '2026-07-22T10:55:00.000Z', '2026-07-22T11:00:00.000Z', ?)
  `).run('f'.repeat(64), NOW);
  const reportPaths: Record<string, string> = {};
  ANALYSIS_REQUIRED_REPORT_TYPES.forEach((reportType, index) => {
    const filePath = path.join(reportDir, `${reportType}.xlsx`);
    fs.writeFileSync(filePath, Buffer.from(`report:${reportType}`));
    reportPaths[reportType] = filePath;
    const fileHash = (index + 1).toString(16).repeat(64).slice(0, 64);
    const reportFileId = Number(database.prepare(`
      INSERT INTO report_files (
        store_id, batch_id, report_type, file_path, file_name, file_size,
        status, imported_rows, file_hash, import_error, last_imported_at,
        created_at, updated_at
      ) VALUES ('store-one', 'batch-1', ?, ?, ?, 100,
        'imported', ?, ?, NULL, ?, ?, ?)
    `).run(
      reportType,
      filePath,
      `${reportType}.xlsx`,
      reportType === 'keyword' ? 2 : 1,
      fileHash,
      NOW,
      NOW,
      NOW,
    ).lastInsertRowid);
    database.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
        file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
      ) VALUES ('store-one', ?, 'run-1', 'batch-1', ?, ?, ?, ?, 100, ?, ?, ?)
    `).run(
      `snapshot-${reportType}`,
      reportFileId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      fileHash,
      reportType === 'keyword' ? 2 : 1,
      NOW,
    );
    database.prepare(`
      INSERT INTO report_import_reconciliations (
        store_id, reconciliation_id, run_id, batch_id, metric_date, report_type,
        currency, expected_rows, actual_rows, expected_cost_1e4, actual_cost_1e4,
        absolute_cost_delta_1e4, tolerance_1e4, within_tolerance, status, reconciled_at
      ) VALUES ('store-one', ?, 'run-1', 'batch-1', '2026-07-22', ?,
        'USD', ?, ?, 10000, 10000, 0, 1, 1, 'matched', ?)
    `).run(
      `recon-${reportType}`,
      reportType,
      reportType === 'keyword' ? 2 : 1,
      reportType === 'keyword' ? 2 : 1,
      NOW,
    );
    database.prepare(`
      INSERT INTO ad_daily_metrics (
        store_id, batch_id, report_type, date, store_name, marketplace_code,
        asin, msku, campaign_name, ad_group_name, targeting, search_term,
        match_type, impressions, clicks, cost, orders, sales, currency,
        acos, cpc, cvr, source_file, source_row, created_at
      ) VALUES ('store-one', 'batch-1', ?, '2026-07-22', 'US Store One', 'US',
        'B0TEST', 'MSKU-1', 'Campaign A', 'Ad Group A', 'door lock', '',
        'exact', 1000, 30, 40, 1, 60, 'USD', 0.6667, 1.49, 0.0333, ?, ?, ?)
    `).run(reportType, filePath, index + 2, NOW);
    if (reportType === 'keyword') {
      database.prepare(`
        INSERT INTO ad_daily_metrics (
          store_id, batch_id, report_type, date, store_name, marketplace_code,
          asin, msku, campaign_name, ad_group_name, targeting, search_term,
          match_type, impressions, clicks, cost, orders, sales, currency,
          acos, cpc, cvr, source_file, source_row, created_at
        ) VALUES ('store-one', 'batch-1', 'keyword', '2026-07-22', 'US Store One', 'US',
          'B0TEST', 'MSKU-1', 'Campaign A', 'Ad Group A', 'door lock 2', '',
          'exact', 800, 20, 30, 1, 50, 'USD', 0.6, 1.49, 0.05, ?, 8, ?)
      `).run(filePath, NOW);
    }
  });
  return reportPaths;
}

export function seedBootstrapPolicyAuthorities(input: {
  database: Database.Database;
  context: StoreContextEnvelope;
  analysisRepository: AnalysisAuthorityRepository;
  missionRepository: MissionDomainRepository;
  rules: PolicyVersionRules;
  entities: ReadonlyArray<{ adEntityId: string; entityName: string; sourceRow: number }>;
}): void {
  const bootstrapPolicy = input.missionRepository.createPolicy(input.context, {
    id: 'bootstrap-policy-analysis-authority',
    name: 'Bootstrap verified keyword authority',
    scope: 'store',
    priority: 9_999,
    actorId: 'fixture-bootstrap',
  });
  const bootstrapDraft = input.missionRepository.createPolicyVersion(input.context, {
    id: 'bootstrap-policy-version-analysis-authority',
    policyId: bootstrapPolicy.id,
    version: 1,
    rules: { ...input.rules, allowedAdEntityIds: [] },
    actorId: 'fixture-bootstrap',
  });
  const bootstrapVersion = input.missionRepository.enablePolicyVersion(input.context, {
    policyId: bootstrapPolicy.id,
    versionId: bootstrapDraft.id,
    expectedPolicyRevision: bootstrapPolicy.revision,
    expectedVersionRevision: bootstrapDraft.revision,
    actorId: 'fixture-bootstrap',
  });
  const bootstrapMission = input.missionRepository.createMission(input.context, {
    id: 'bootstrap-mission-analysis-authority',
    dataBatchId: 'batch-1',
    policyVersionId: bootstrapVersion.id,
    productId: 'B0TEST',
    title: 'Bootstrap immutable Ads identity evidence',
    objective: 'Bind imported keyword rows to verified opaque Ads entities.',
    observationStartsAt: '2026-07-22T00:00:00.000Z',
    observationEndsAt: '2026-07-29T00:00:00.000Z',
    successCriteria: ['Verified keyword authority is materialized'],
    guardrails: ['Bootstrap policy cannot authorize an Ads object'],
    actorId: 'fixture-bootstrap',
  });
  const evidence = input.analysisRepository.sealEvidencePackage(input.context, {
    missionId: bootstrapMission.id,
    dateFrom: '2026-07-01',
    dateTo: (input.database.prepare('SELECT date_end FROM lingxing_report_batches WHERE store_id=? AND id=?')
      .get(input.context.storeId, 'batch-1') as { date_end: string }).date_end,
    asin: 'B0TEST',
    freshnessWindowHours: 48,
    ruleRevision: RULE_REVISION,
    modelRevision: 'fixture-bootstrap-authority-v1',
  });
  const keywordSnapshot = input.database.prepare(`
    SELECT file_hash AS fileHash
    FROM report_import_file_snapshots
    WHERE store_id = ? AND run_id = ? AND batch_id = ? AND report_type = 'keyword'
      AND report_file_id IS NOT NULL
    ORDER BY snapshot_id
    LIMIT 1
  `).get(
    input.context.storeId,
    evidence.importRunId,
    evidence.dataBatchId,
  ) as { fileHash: string } | undefined;
  if (!keywordSnapshot) throw new Error('Expected imported keyword snapshot for bootstrap authority.');
  input.entities.forEach((entity, index) => {
    input.analysisRepository.registerVerifiedAdEntity(input.context, {
      authorityId: `bootstrap-authority-${entity.adEntityId}`,
      evidencePackageId: evidence.id,
      adEntityId: entity.adEntityId,
      entityType: 'keyword',
      entityName: entity.entityName,
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      sourceReportType: 'keyword',
      sourceFileHash: keywordSnapshot.fileHash,
      sourceRow: entity.sourceRow,
      identitySource: 'ads_ui',
      proofSha256: (index + 10).toString(16).repeat(64).slice(0, 64),
      verifiedBy: 'fixture-bootstrap',
      verifiedAt: NOW,
    });
  });
  input.missionRepository.archiveMission(input.context, {
    id: bootstrapMission.id,
    expectedRevision: bootstrapMission.revision,
    actorId: 'fixture-bootstrap',
    reason: 'Bootstrap identity evidence is complete.',
  });
  const activeBootstrapPolicy = input.missionRepository.getPolicy(input.context, bootstrapPolicy.id)!;
  const disabledBootstrapPolicy = input.missionRepository.disablePolicy(input.context, {
    id: activeBootstrapPolicy.id,
    expectedRevision: activeBootstrapPolicy.revision,
    actorId: 'fixture-bootstrap',
    reason: 'Bootstrap identity evidence is complete.',
  });
  input.missionRepository.archivePolicy(input.context, {
    id: disabledBootstrapPolicy.id,
    expectedRevision: disabledBootstrapPolicy.revision,
    actorId: 'fixture-bootstrap',
    reason: 'Bootstrap identity evidence is complete.',
  });
}

export function recommendation(overrides: Partial<Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>> = {}): Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    taskId: 'task-1',
    storeName: 'US Store One',
    marketplaceCode: 'US',
    asin: 'B0TEST',
    msku: 'MSKU-1',
    entityType: 'target',
    entityId: 'synthetic-1',
    entityName: 'door lock',
    actionType: 'lower_bid',
    currentValue: '1.49',
    recommendedValue: '1.35',
    reason: 'ACOS is above the configured guardrail.',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 1,
      sales: 60,
      acos: 0.6667,
      cpc: 1.49,
      cvr: 0.0333,
      batchId: 'batch-1',
      reportType: 'keyword',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      targeting: 'door lock',
      sourceRow: 7,
      decisionSource: 'rule_ai',
      decisionAgreement: 'aligned',
      writableTarget: {
        entityType: 'keyword',
        entityId: 'opaque-keyword-1',
        entityName: 'door lock',
        campaignName: 'Campaign A',
        adGroupName: 'Ad Group A',
        metricDate: '2026-07-22',
        sourceFile: '',
        sourceRow: 7,
        identitySource: 'ads_ui',
        verifiedBy: 'operator',
        verifiedAt: NOW,
        verificationNote: 'Matched the visible Ads row.',
        identityProofPath: '',
      },
    },
    confidence: 0.88,
    riskLevel: 'APPROVAL',
    status: 'pending',
    ...overrides,
  };
}

export function approveHumanDecisions(harness: Harness): void {
  const latest = harness.analysisRepository.getLatestActionBatch(harness.context, harness.missionId)!;
  for (const decision of harness.missionRepository.listDecisions(harness.context, { missionId: harness.missionId })) {
    if (decision.actionRevision !== latest.actionRevision || !['proposed', 'needs_approval'].includes(decision.status)) continue;
    harness.missionRepository.resolveDecision(harness.context, {
      id: decision.id, expectedRevision: decision.revision, status: 'approved', actorId: 'operator',
      reason: `隔离测试人工判断：核对 ${decision.title} 的当前花费与回读，接受建议降价。`,
    });
  }
}

export function runRequest(harness: Harness) {
  return harness.service.runMissionAnalysis({
    context: harness.context,
    missionId: harness.missionId,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-22',
  });
}

export function seedTrustedCausalMemory(
  harness: Harness,
  ordinal: number,
  observedEffect = '关键词竞价降低后 ACOS 改善，广告订单保持稳定。',
): void {
  const event = harness.missionRepository.appendCausalEvent(harness.context, {
    id: `trusted-analysis-memory-${ordinal}`,
    stage: 'EFFECT',
    eventType: 'experiment_effect_verified',
    entityType: 'experiment',
    entityId: `experiment-memory-${ordinal}`,
    missionId: harness.missionId,
    title: '经营实验效果已核验',
    observedEffect,
    status: 'verified',
    source: 'experiment-evaluator',
    actorId: 'experiment-evaluator',
  });
  harness.missionRepository.appendEvidenceRef(harness.context, {
    id: `trusted-analysis-memory-proof-${ordinal}`,
    eventId: event.id,
    evidenceType: 'experiment_result',
    evidenceRef: `artifact:experiment-result:${ordinal}`,
    sha256: ordinal.toString(16).repeat(64),
  });
}

export function seedPriorGrant(
  harness: Harness,
  decisionId: string,
  adEntityId: string,
  issuedAt = NOW,
): void {
  const mission = harness.missionRepository.getMission(harness.context, harness.missionId)!;
  const policy = harness.missionRepository.getPolicyVersion(harness.context, harness.policyVersionId)!;
  harness.database.prepare(`
    INSERT INTO mission_grants (
      id, store_id, marketplace, currency, mission_id, mission_revision, decision_ids_json,
      action_revision, allowed_action_types_json, allowed_ad_entity_ids_json,
      max_change_pct, total_impact_budget, expires_at,
      policy_version_id, policy_revision, required_evidence_json,
      stop_conditions_json, issuer_type, issuer_actor_id,
      issued_at, created_session_generation
    ) VALUES (
      'prior-rate-limit-grant', ?, 'US', 'USD', ?, ?, ?,
      999, '["set_keyword_bid"]', ?, 10, 1, '2026-07-23T12:00:00.000Z',
      ?, ?, ?, ?, 'human', 'operator', ?, ?
    )
  `).run(
    harness.context.storeId,
    mission.id,
    mission.revision,
    JSON.stringify([decisionId]),
    JSON.stringify([adEntityId]),
    policy.id,
    policy.revision,
    JSON.stringify(policy.rules.requiredEvidence),
    JSON.stringify(policy.rules.stopConditions),
    issuedAt,
    harness.context.sessionGeneration,
  );
}

