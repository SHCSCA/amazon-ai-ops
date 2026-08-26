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
  type AnalysisAuthorityServiceOptions,
  type CapturedAnalysisGenerationAuthority,
} from './analysis-authority-service';

const NOW = '2026-07-22T12:00:00.000Z';
const RULE_REVISION = 'a'.repeat(64);
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

interface Harness {
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
}

function createHarness(options: {
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
  recommendationEvidencePatch?: Partial<ActionRecommendation['evidence']>;
} = {}): Harness {
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
    ) VALUES ('batch-1', '2026-07-01', '2026-07-22', ?, 'US', 'completed',
      ?, ?, ?, 'store-one', 'request-1', 'profile-one', '2026-07-22', 4)
  `).run(options.batchStoreName ?? 'US Store One', path.join(directory, 'reports'), NOW, NOW);
  const reportPaths = seedImportAuthority(database, directory);
  const proofPath = path.join(directory, 'proof.png');
  fs.writeFileSync(proofPath, Buffer.from('verified visible Ads identity proof'));

  const analysisRepository = new AnalysisAuthorityRepository(database, { now: () => new Date(NOW) });
  const missionRepository = new MissionDomainRepository(database, {
    now: () => new Date(NOW),
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
    now: () => new Date(NOW),
    generateRecommendations: generationDelegate = async (scope) => {
      expect(scope).toMatchObject({
        storeName: 'US Store One',
        marketplaceCode: 'US',
        batchId: 'batch-1',
      });
      const recommendationIds: number[] = [];
      for (let index = 1; index <= recommendationCount; index += 1) {
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
        recommendationIds.push(recommendationRepository.insertForStore(context.storeId, rec));
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
        generated: recommendationIds.length,
        metrics: 8,
        skippedDuplicates: 0,
        refreshedDuplicates: 0,
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
          dateFrom: '2026-07-01',
          dateTo: '2026-07-22',
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
  };
}

function seedImportAuthority(database: Database.Database, directory: string): Record<string, string> {
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

function seedBootstrapPolicyAuthorities(input: {
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
    dateTo: '2026-07-22',
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

function recommendation(overrides: Partial<Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>> = {}): Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'> {
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

function runRequest(harness: Harness) {
  return harness.service.runMissionAnalysis({
    context: harness.context,
    missionId: harness.missionId,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-22',
  });
}

function seedPriorGrant(
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

describe('AnalysisAuthorityService', () => {
  it('uses the logical Store display name when the Lingxing selector snapshot has a different name', async () => {
    const harness = createHarness({ batchStoreName: 'Lingxing External Selector Name' });

    await expect(runRequest(harness)).resolves.toMatchObject({
      generatedRecommendations: 1,
    });
  });

  it('runs real recommendation generation into a path-free evidence/proposal/Decision projection', async () => {
    const harness = createHarness();
    const result = await runRequest(harness);
    expect(result.evidencePackage.metricRowCount).toBe(9);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      adEntityId: 'opaque-keyword-1',
      source: 'rule_ai',
      authorization: { human: { eligible: true } },
    });
    expect(JSON.stringify(result)).not.toMatch(/\.xlsx|\.png|analysis-service-/i);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(projection.actionBatches).toEqual([
      expect.objectContaining({ id: result.proposals[0].actionBatchId, actionRevision: 1 }),
    ]);
    expect(projection.decisionLinks).toHaveLength(1);
    expect(projection.proposals).toHaveLength(1);
    const decision = harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    );
    expect(decision?.status).toBe('needs_approval');
    expect(decision).toMatchObject({ currentValue: 1.49, recommendedValue: 1.35 });
  });

  it('fails closed when the Mission changes during asynchronous recommendation generation', async () => {
    const harness = createHarness({ mutateMissionDuringGeneration: true });

    await expect(runRequest(harness)).rejects.toThrow('Mission changed while its analysis was running');
    expect(harness.analysisRepository.getLatestActionBatch(
      harness.context,
      harness.missionId,
    )).toBeUndefined();
  });

  it('uses one explicit manual batch confirmation to approve Decisions and issue one exact grant', async () => {
    const harness = createHarness({ recommendationCount: 2 });
    const result = await runRequest(harness);
    expect(result.proposals).toHaveLength(2);
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(authorized).toMatchObject({
      authorized: true,
      mode: 'manual_approval',
      proposalIds: expect.arrayContaining(result.proposals.map((proposal) => proposal.id)),
    });
    expect(authorized.grant?.issuer.type).toBe('human');
    expect(authorized.grant?.decisionIds).toHaveLength(2);
    for (const decisionId of authorized.decisionIds) {
      expect(harness.missionRepository.getDecision(harness.context, decisionId)?.status).toBe('approved');
    }
    expect(harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: [result.proposals[0].id],
    }).blockers).toContain('必须整批授权，不能只批准动作批次的一部分。');
    expect(harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    })).toMatchObject({ authorized: true, mode: 'manual_approval', grant: { id: authorized.grant?.id } });
  });

  it('policy-auto approves aligned Decisions and issues the same durable MissionGrant model', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const result = await runRequest(harness);
    expect(result.proposals[0].authorization.policy.eligible).toBe(true);
    expect(result.automaticAuthorization).toMatchObject({ authorized: true, mode: 'policy_auto' });
    expect(result.automaticAuthorization?.grant?.issuer.type).toBe('policy');
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(authorized).toMatchObject({ authorized: true, mode: 'policy_auto' });
    expect(authorized.grant?.issuer.type).toBe('policy');
    expect(authorized.grant?.id).toBe(result.automaticAuthorization?.grant?.id);
    const decision = harness.missionRepository.getDecision(harness.context, authorized.decisionIds[0]);
    expect(decision?.status).toBe('approved');
  });

  it('does not issue or dispatch a policy grant for legacy metadata without an explicit aligned rule-AI decision', async () => {
    const onAutomaticGrantIssued = vi.fn();
    const harness = createHarness({
      autonomyMode: 'policy_auto',
      onAutomaticGrantIssued,
      recommendationEvidencePatch: {
        decisionSource: undefined,
        decisionAgreement: undefined,
        decisionRequiresReview: undefined,
        aiStrategySource: 'ai',
        explanationSource: 'ai',
      },
    });

    const result = await runRequest(harness);
    expect(result.proposals[0]).toMatchObject({
      source: 'rule',
      authorization: {
        policy: {
          eligible: false,
          blockers: expect.arrayContaining(['POLICY_REQUIRES_RULE_AI_ALIGNMENT']),
        },
      },
    });
    expect(result.automaticAuthorization).toMatchObject({
      authorized: false,
      mode: 'policy_auto',
    });
    expect(onAutomaticGrantIssued).not.toHaveBeenCalled();
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
  });

  it('notifies execution exactly once for a policy-auto grant and never for manual authorization', async () => {
    const onAutomaticGrantIssued = vi.fn();
    const automaticHarness = createHarness({
      autonomyMode: 'policy_auto',
      onAutomaticGrantIssued,
    });

    const automatic = await runRequest(automaticHarness);
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);
    expect(onAutomaticGrantIssued).toHaveBeenCalledWith(
      automaticHarness.context,
      automatic.automaticAuthorization?.grant,
    );
    automaticHarness.service.authorizeProposalBatch({
      context: automaticHarness.context,
      missionId: automaticHarness.missionId,
      proposalIds: automatic.proposals.map((proposal) => proposal.id),
    });
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);

    const manualHarness = createHarness({ onAutomaticGrantIssued });
    const manual = await runRequest(manualHarness);
    manualHarness.service.authorizeProposalBatch({
      context: manualHarness.context,
      missionId: manualHarness.missionId,
      proposalIds: manual.proposals.map((proposal) => proposal.id),
    });
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);
  });

  it('never downgrades an automatic authorization attempt into a human grant when mode changes', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const readRuntime = harness.missionRepository.getPolicyRuntime.bind(harness.missionRepository);
    let reads = 0;
    vi.spyOn(harness.missionRepository, 'getPolicyRuntime').mockImplementation((context) => {
      const runtime = readRuntime(context);
      reads += 1;
      return reads === 1 ? runtime : { ...runtime, autonomyMode: 'manual_approval' };
    });
    const result = await runRequest(harness);
    expect(result.automaticAuthorization).toMatchObject({
      authorized: false,
      mode: 'policy_auto',
      blockers: [expect.stringMatching(/未降级为人工授权/)],
    });
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('needs_approval');
  });

  it('keeps rule fallback and missing opaque Ads identity visible but non-authorizable', async () => {
    const harness = createHarness({ withWritableTarget: false, fallback: true });
    const result = await runRequest(harness);
    expect(result.proposals[0]).toMatchObject({
      source: 'rule_fallback',
      authorization: {
        human: { eligible: false },
        policy: { eligible: false },
      },
    });
    expect(result.proposals[0].authorization.human.blockers).toEqual(expect.arrayContaining([
      'MISSING_STABLE_AD_ENTITY',
      'RULE_FALLBACK_NOT_AUTHORIZABLE',
    ]));
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('blocked');
  });

  it('derives product scope and proof authority in Main instead of trusting Renderer fields or arbitrary files', async () => {
    const harness = createHarness({ proofAllowed: false });
    const result = await runRequest(harness);
    expect(result.evidencePackage.asin).toBe('B0TEST');
    expect(result.proposals[0].adEntityId).toBeUndefined();
    expect(result.proposals[0].authorization.human.blockers).toContain('MISSING_STABLE_AD_ENTITY');
    expect(result.ai.detail).not.toMatch(/provider unavailable|AI and rules aligned/i);
  });

  it('keeps one immutable generation authority when mutable settings change A to B to A during an AI await', async () => {
    let signalStarted!: () => void;
    let releaseGeneration!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    const authoritiesUsed: Array<{ ruleRevision: string; modelRevision: string }> = [];
    const harness = createHarness({
      generationAuthorityFactory: (captured) => Object.freeze({
        ...captured,
        generateRecommendations: async (
          scope: Parameters<CapturedAnalysisGenerationAuthority['generateRecommendations']>[0],
        ) => {
          authoritiesUsed.push({
            ruleRevision: captured.ruleRevision,
            modelRevision: captured.modelRevision,
          });
          signalStarted();
          await generationGate;
          return captured.generateRecommendations(scope);
        },
      }),
    });
    const originalModelRevision = harness.modelRevision.value;

    const pending = runRequest(harness);
    await started;
    harness.ruleRevision.value = 'b'.repeat(64);
    harness.modelRevision.value = 'changed-during-generation';
    harness.ruleRevision.value = RULE_REVISION;
    harness.modelRevision.value = originalModelRevision;
    releaseGeneration();

    const result = await pending;
    expect(authoritiesUsed).toEqual([{
      ruleRevision: RULE_REVISION,
      modelRevision: originalModelRevision,
    }]);
    expect(result.evidencePackage).toMatchObject({
      ruleRevision: RULE_REVISION,
      modelRevision: originalModelRevision,
    });
    const authorization = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(authorization.blockers).not.toContain('当前规则 revision 已变化；必须重新分析。');
    expect(authorization.blockers).not.toContain('当前 AI 模型 revision 已变化；必须重新分析。');
  });

  it('blocks stale Mission, rule, AI runtime and non-latest action revisions before changing Decisions', async () => {
    const missionHarness = createHarness();
    const missionResult = await runRequest(missionHarness);
    const mission = missionHarness.missionRepository.getMission(missionHarness.context, missionHarness.missionId)!;
    missionHarness.missionRepository.updateMission(missionHarness.context, {
      id: mission.id,
      expectedRevision: mission.revision,
      actorId: 'operator',
      patch: { title: 'Mission changed after analysis' },
    });
    const missionBlocked = missionHarness.service.authorizeProposalBatch({
      context: missionHarness.context,
      missionId: missionHarness.missionId,
      proposalIds: missionResult.proposals.map((proposal) => proposal.id),
    });
    expect(missionBlocked.blockers).toContain('Mission 已修订；旧分析建议必须重新运行后才能授权。');

    const ruleHarness = createHarness();
    const ruleResult = await runRequest(ruleHarness);
    ruleHarness.ruleRevision.value = 'b'.repeat(64);
    expect(ruleHarness.service.authorizeProposalBatch({
      context: ruleHarness.context,
      missionId: ruleHarness.missionId,
      proposalIds: ruleResult.proposals.map((proposal) => proposal.id),
    }).blockers).toContain('当前规则 revision 已变化；必须重新分析。');

    const modelHarness = createHarness();
    const modelResult = await runRequest(modelHarness);
    modelHarness.modelRevision.value = 'changed-ai-runtime-revision';
    expect(modelHarness.service.authorizeProposalBatch({
      context: modelHarness.context,
      missionId: modelHarness.missionId,
      proposalIds: modelResult.proposals.map((proposal) => proposal.id),
    }).blockers).toContain('当前 AI 模型 revision 已变化；必须重新分析。');

    const latestHarness = createHarness();
    const latestResult = await runRequest(latestHarness);
    latestHarness.analysisRepository.createActionBatch(latestHarness.context, {
      id: 'newer-empty-analysis-batch',
      missionId: latestHarness.missionId,
      evidencePackageId: latestResult.evidencePackage.id,
      expectedMissionRevision: latestHarness.missionRepository.getMission(
        latestHarness.context,
        latestHarness.missionId,
      )!.revision,
    });
    expect(latestHarness.service.authorizeProposalBatch({
      context: latestHarness.context,
      missionId: latestHarness.missionId,
      proposalIds: latestResult.proposals.map((proposal) => proposal.id),
    }).blockers).toContain('只能授权当前 Mission 的最新分析动作批次。');
  });

  it('rolls back batch Decision approvals when immutable grant issuance fails', async () => {
    const harness = createHarness({ recommendationCount: 2 });
    const result = await runRequest(harness);
    vi.spyOn(harness.missionRepository, 'issueMissionGrant').mockImplementation(() => {
      throw new Error('simulated grant insert failure');
    });
    expect(() => harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    })).toThrow(/simulated grant insert failure/);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(projection.decisionLinks.map((link) => (
      harness.missionRepository.getDecision(harness.context, link.decisionId)?.status
    ))).toEqual(['needs_approval', 'needs_approval']);
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
  });

  it('does not resurrect a revoked grant for the same action revision', async () => {
    const harness = createHarness();
    const result = await runRequest(harness);
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    harness.missionRepository.appendMissionGrantEvent(harness.context, {
      id: 'grant-event-revoked-test',
      grantId: authorized.grant!.id,
      eventType: 'revoked',
      actorId: 'operator',
      reason: 'facts changed',
    });
    const repeated = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(repeated).toMatchObject({ authorized: false, mode: 'manual_approval' });
    expect(repeated.blockers.join(' ')).toMatch(/revoked/);
  });

  it('fails closed outside the immutable policy execution window', async () => {
    const harness = createHarness({
      executionWindow: {
        timeZone: 'America/Los_Angeles',
        daysOfWeek: [3],
        start: '06:00',
        end: '07:00',
      },
    });
    const result = await runRequest(harness);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked).toMatchObject({ authorized: false });
    expect(blocked.blockers.join(' ')).toMatch(/执行窗口/);
  });

  it('enforces the per-business-day action limit before approving the batch', async () => {
    const harness = createHarness({ maxDailyActionCount: 1 });
    const result = await runRequest(harness);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    seedPriorGrant(harness, projection.decisionLinks[0].decisionId, result.proposals[0].adEntityId!);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked.blockers.join(' ')).toMatch(/单日动作数/);
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('needs_approval');
  });

  it('enforces per-entity cooldown before approving the batch', async () => {
    const harness = createHarness({ cooldownMinutes: 90 });
    const result = await runRequest(harness);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    seedPriorGrant(harness, projection.decisionLinks[0].decisionId, result.proposals[0].adEntityId!);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked.blockers.join(' ')).toMatch(/冷却期/);
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('needs_approval');
  });
});
