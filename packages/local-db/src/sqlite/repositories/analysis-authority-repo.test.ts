import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  normalizeStoreContextEnvelope,
  type ActionRecommendation,
  type PolicyVersionRules,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { AnalysisAuthorityRepository, AnalysisAuthorityRepositoryError } from './analysis-authority-repo';
import { MissionDomainRepository } from './mission-domain-repo';
import { RecommendationRepository } from './recommendation-repo';

const NOW = '2026-07-22T12:00:00.000Z';
const HASHES = ANALYSIS_REQUIRED_REPORT_TYPES.map((_, index) => (index + 1).toString(16).repeat(64).slice(0, 64));
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
  database: Database.Database;
  repository: AnalysisAuthorityRepository;
  missionRepository: MissionDomainRepository;
  recommendationRepository: RecommendationRepository;
  context: StoreContextEnvelope;
  otherContext: StoreContextEnvelope;
  missionId: string;
  policyVersionId: string;
}

function createHarness(options: { missingReportType?: string } = {}): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-analysis-repo-'));
  tempDirs.push(directory);
  const database = initSqlite(path.join(directory, 'app.db'));
  databases.push(database);
  for (const [storeId, profileId, displayName] of [
    ['store-one', 'profile-one', 'US Store One'],
    ['store-two', 'profile-two', 'US Store Two'],
  ] as const) {
    database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name,
        status, business_timezone, created_at, updated_at
      ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles', ?, ?)
    `).run(storeId, profileId, displayName, NOW, NOW);
    for (const provider of ['lingxing', 'amazon_ads']) {
      database.prepare(`
        INSERT INTO store_session_metadata (
          store_id, provider, browser_profile_id, status, session_generation,
          observed_at, verified_at, updated_at
        ) VALUES (?, ?, ?, 'ready', 4, ?, ?, ?)
      `).run(storeId, provider, profileId, NOW, NOW, NOW);
    }
    database.prepare(`
      INSERT INTO lingxing_report_batches (
        id, date_start, date_end, store_name, marketplace_code, status,
        download_dir, created_at, completed_at, store_id, request_id,
        browser_profile_id, business_date, session_generation
      ) VALUES (?, '2026-07-01', '2026-07-22', ?, 'US', 'completed',
        ?, ?, ?, ?, ?, ?, '2026-07-22', 4)
    `).run(
      `batch-${storeId}`,
      displayName,
      `logical-download:${storeId}`,
      NOW,
      NOW,
      storeId,
      `request-${storeId}`,
      profileId,
    );
  }
  const context = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  const otherContext = normalizeStoreContextEnvelope({
    storeId: 'store-two',
    browserProfileId: 'profile-two',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  seedImportAuthority(database, context.storeId, 'batch-store-one', options.missingReportType);
  const repository = new AnalysisAuthorityRepository(database, { now: () => new Date(NOW) });
  const missionRepository = new MissionDomainRepository(database, {
    now: () => new Date(NOW),
    references: {
      productBelongsToStore: () => true,
      adEntityBelongsToStore: (authorized, adEntityId) => (
        repository.adEntityBelongsToStore(authorized, adEntityId)
      ),
      adEntitySupportsKeywordBid: (authorized, adEntityId) => {
        const authority = repository.getLatestVerifiedAdEntityById(authorized, adEntityId);
        return authority?.entityType === 'keyword' && authority.sourceReportType === 'keyword';
      },
    },
  });
  const authorityRules: PolicyVersionRules = {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: ['opaque-keyword-1'],
    maxChangePct: 10,
    totalImpactBudget: 100,
    maxDailyActionCount: 100,
    cooldownMinutes: 0,
    executionWindow: {
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
  if (!options.missingReportType) {
    seedBootstrapPolicyAuthority({
      database,
      context,
      repository,
      missionRepository,
      rules: authorityRules,
    });
  }
  const rules: PolicyVersionRules = options.missingReportType
    ? { ...authorityRules, allowedAdEntityIds: [] }
    : authorityRules;
  const policy = missionRepository.createPolicy(context, {
    id: 'policy-1',
    name: 'US keyword bid guardrail',
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
  const mission = missionRepository.createMission(context, {
    id: 'mission-1',
    dataBatchId: 'batch-store-one',
    policyVersionId: policyVersion.id,
    title: 'Reduce inefficient keyword bids',
    objective: 'Reduce ACOS without losing orders',
    observationStartsAt: '2026-07-22T00:00:00.000Z',
    observationEndsAt: '2026-07-29T00:00:00.000Z',
    successCriteria: ['ACOS improves'],
    guardrails: ['Orders do not fall more than 10%'],
    actorId: 'operator',
  });
  return {
    database,
    repository,
    missionRepository,
    recommendationRepository: new RecommendationRepository(database),
    context,
    otherContext,
    missionId: mission.id,
    policyVersionId: policyVersion.id,
  };
}

function seedImportAuthority(
  database: Database.Database,
  storeId: string,
  batchId: string,
  missingReportType?: string,
): void {
  database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (?, 'run-1', 'idem-1', ?, ?, 'completed', 8, 8, 8, ?, ?, ?)
  `).run(storeId, 'f'.repeat(64), batchId, '2026-07-22T10:55:00.000Z', '2026-07-22T11:00:00.000Z', NOW);
  ANALYSIS_REQUIRED_REPORT_TYPES.forEach((reportType, index) => {
    if (reportType === missingReportType) return;
    const filePath = `D:/reports/${reportType}.xlsx`;
    const reportFileId = Number(database.prepare(`
      INSERT INTO report_files (
        store_id, batch_id, report_type, file_path, file_name, file_size,
        status, imported_rows, file_hash, import_error, last_imported_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 100,
        'imported', 1, ?, NULL, ?, ?, ?)
    `).run(
      storeId,
      batchId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      HASHES[index],
      NOW,
      NOW,
      NOW,
    ).lastInsertRowid);
    database.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
        file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
      ) VALUES (?, ?, 'run-1', ?, ?, ?, ?, ?, 100, ?, 1, ?)
    `).run(
      storeId,
      `snapshot-${reportType}`,
      batchId,
      reportFileId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      HASHES[index],
      NOW,
    );
    database.prepare(`
      INSERT INTO report_import_reconciliations (
        store_id, reconciliation_id, run_id, batch_id, metric_date, report_type,
        currency, expected_rows, actual_rows, expected_cost_1e4, actual_cost_1e4,
        absolute_cost_delta_1e4, tolerance_1e4, within_tolerance, status, reconciled_at
      ) VALUES (?, ?, 'run-1', ?, '2026-07-22', ?, 'USD', 1, 1, 10000, 10000, 0, 1, 1, 'matched', ?)
    `).run(storeId, `recon-${reportType}`, batchId, reportType, NOW);
    database.prepare(`
      INSERT INTO ad_daily_metrics (
        store_id, batch_id, report_type, date, store_name, marketplace_code,
        asin, msku, campaign_name, ad_group_name, targeting, search_term,
        match_type, impressions, clicks, cost, orders, sales, currency,
        acos, cpc, cvr, source_file, source_row, created_at
      ) VALUES (?, ?, ?, '2026-07-22', 'US Store One', 'US',
        'B0TEST', 'MSKU-1', 'Campaign A', 'Ad Group A', 'door lock', '',
        'exact', 1000, 30, 40, 1, 60, 'USD', 0.6667, 1.49, 0.0333, ?, ?, ?)
    `).run(storeId, batchId, reportType, filePath, index + 2, NOW);
  });
}

function seedBootstrapPolicyAuthority(input: {
  database: Database.Database;
  context: StoreContextEnvelope;
  repository: AnalysisAuthorityRepository;
  missionRepository: MissionDomainRepository;
  rules: PolicyVersionRules;
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
    dataBatchId: 'batch-store-one',
    policyVersionId: bootstrapVersion.id,
    title: 'Bootstrap immutable Ads identity evidence',
    objective: 'Bind an imported keyword row to one verified opaque Ads entity.',
    observationStartsAt: '2026-07-22T00:00:00.000Z',
    observationEndsAt: '2026-07-29T00:00:00.000Z',
    successCriteria: ['Verified keyword authority is materialized'],
    guardrails: ['Bootstrap policy cannot authorize an Ads object'],
    actorId: 'fixture-bootstrap',
  });
  const evidence = input.repository.sealEvidencePackage(input.context, {
    missionId: bootstrapMission.id,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-22',
    asin: 'B0TEST',
    freshnessWindowHours: 48,
    ruleRevision: 'a'.repeat(64),
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
  input.repository.registerVerifiedAdEntity(input.context, {
    authorityId: 'bootstrap-authority-opaque-keyword-1',
    evidencePackageId: evidence.id,
    adEntityId: 'opaque-keyword-1',
    entityType: 'keyword',
    entityName: 'door lock',
    campaignName: 'Campaign A',
    adGroupName: 'Ad Group A',
    sourceReportType: 'keyword',
    sourceFileHash: keywordSnapshot.fileHash,
    sourceRow: 7,
    identitySource: 'ads_ui',
    proofSha256: 'e'.repeat(64),
    verifiedBy: 'fixture-bootstrap',
    verifiedAt: NOW,
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

function seedCorrectedImportAuthority(database: Database.Database, storeId: string, batchId: string): void {
  database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (?, 'run-2', 'idem-2', ?, ?, 'completed', 8, 8, 8, ?, ?, ?)
  `).run(
    storeId,
    'e'.repeat(64),
    batchId,
    '2026-07-22T11:05:00.000Z',
    '2026-07-22T11:10:00.000Z',
    NOW,
  );
  ANALYSIS_REQUIRED_REPORT_TYPES.forEach((reportType, index) => {
    const filePath = `D:/reports/${reportType}.xlsx`;
    const correctedHash = (index + 9).toString(16).repeat(64).slice(0, 64);
    const reportFile = database.prepare(`
      SELECT id
      FROM report_files
      WHERE store_id = ? AND batch_id = ? AND report_type = ? AND file_path = ?
    `).get(storeId, batchId, reportType, filePath) as { id: number } | undefined;
    if (!reportFile) throw new Error(`Expected imported report file for corrected ${reportType} snapshot.`);
    database.prepare(`
      UPDATE report_files
      SET file_hash = ?, status = 'imported', last_imported_at = ?, updated_at = ?
      WHERE id = ?
    `).run(correctedHash, '2026-07-22T11:10:00.000Z', NOW, reportFile.id);
    database.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
        file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
      ) VALUES (?, ?, 'run-2', ?, ?, ?, ?, ?, 100, ?, 1, ?)
    `).run(
      storeId,
      `snapshot-corrected-${reportType}`,
      batchId,
      reportFile.id,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      correctedHash,
      '2026-07-22T11:10:00.000Z',
    );
    database.prepare(`
      INSERT INTO report_import_reconciliations (
        store_id, reconciliation_id, run_id, batch_id, metric_date, report_type,
        currency, expected_rows, actual_rows, expected_cost_1e4, actual_cost_1e4,
        absolute_cost_delta_1e4, tolerance_1e4, within_tolerance, status, reconciled_at
      ) VALUES (?, ?, 'run-2', ?, '2026-07-22', ?, 'USD', 1, 1, 10000, 10000, 0, 1, 1, 'matched', ?)
    `).run(storeId, `recon-corrected-${reportType}`, batchId, reportType, '2026-07-22T11:10:00.000Z');
  });
}

function seal(harness: Harness) {
  return harness.repository.sealEvidencePackage(harness.context, {
    missionId: harness.missionId,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-22',
    asin: 'B0TEST',
    freshnessWindowHours: 48,
    ruleRevision: 'a'.repeat(64),
    modelRevision: 'gpt-5.6:ad_strategy_diagnosis_v1',
  });
}

function insertRecommendation(
  harness: Harness,
  evidencePatch: Record<string, unknown> = {},
): number {
  const rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'> = {
    taskId: 'task-1',
    storeName: 'US Store One',
    marketplaceCode: 'US',
    asin: 'B0TEST',
    msku: 'MSKU-1',
    entityType: 'target',
    entityId: 'synthetic-Campaign-A-Ad-Group-A-door-lock',
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
      batchId: 'batch-store-one',
      reportType: 'keyword',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      targeting: 'door lock',
      decisionSource: 'rule_ai',
      decisionAgreement: 'aligned',
      writableTarget: {
        entityType: 'keyword',
        entityId: 'opaque-keyword-1',
        entityName: 'door lock',
        campaignName: 'Campaign A',
        adGroupName: 'Ad Group A',
        metricDate: '2026-07-22',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: 7,
        identitySource: 'ads_ui',
        verifiedBy: 'operator',
        verifiedAt: NOW,
        verificationNote: 'visible Ads row matched',
        identityProofPath: 'D:/proof/keyword.png',
      },
      ...evidencePatch,
    },
    confidence: 0.88,
    riskLevel: 'APPROVAL',
    status: 'pending',
  };
  return harness.recommendationRepository.insertForStore(harness.context.storeId, rec);
}

function registerAuthority(harness: Harness, evidencePackageId: string) {
  return harness.repository.registerVerifiedAdEntity(harness.context, {
    authorityId: 'authority-1',
    evidencePackageId,
    adEntityId: 'opaque-keyword-1',
    entityType: 'keyword',
    entityName: 'door lock',
    campaignName: 'Campaign A',
    adGroupName: 'Ad Group A',
    sourceReportType: 'keyword',
    sourceFileHash: HASHES[5],
    sourceRow: 7,
    identitySource: 'ads_ui',
    proofSha256: 'e'.repeat(64),
    verifiedBy: 'operator',
    verifiedAt: NOW,
  });
}

function enablePolicyAuto(harness: Harness): void {
  const runtime = harness.missionRepository.getPolicyRuntime(harness.context);
  harness.missionRepository.updatePolicyRuntime(harness.context, {
    expectedRevision: runtime.revision,
    actorId: 'operator',
    patch: {
      autonomyMode: 'policy_auto',
      activePolicyVersionId: harness.policyVersionId,
      killSwitch: false,
      circuitBreakerState: 'closed',
    },
  });
}

describe('AnalysisAuthorityRepository', () => {
  it('seals a path-free exact 8/8 evidence package and remains append-only', () => {
    const harness = createHarness();
    const record = seal(harness);
    expect(record.reportTypes).toEqual(ANALYSIS_REQUIRED_REPORT_TYPES);
    expect(record.sources).toHaveLength(8);
    expect(record.metricRowCount).toBe(8);
    expect(JSON.stringify(record)).not.toMatch(/D:\/|D:\\|sourceFile|filePath/i);
    expect(harness.repository.sealEvidencePackage(harness.context, {
      missionId: harness.missionId,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
      asin: 'B0TEST',
      freshnessWindowHours: 48,
      ruleRevision: 'a'.repeat(64),
      modelRevision: 'gpt-5.6:ad_strategy_diagnosis_v1',
    }).id).toBe(record.id);
    expect(() => harness.database.prepare(`
      UPDATE analysis_evidence_packages SET metric_row_count = 9 WHERE id = ?
    `).run(record.id)).toThrow(/append-only/i);
  });

  it('derives evidence identity from immutable content and avoids corrected re-import collisions', () => {
    const harness = createHarness();
    const first = seal(harness);
    expect(seal(harness)).toMatchObject({ id: first.id, packageHash: first.packageHash, importRunId: 'run-1' });
    seedCorrectedImportAuthority(harness.database, harness.context.storeId, 'batch-store-one');
    const corrected = seal(harness);
    expect(corrected).toMatchObject({ importRunId: 'run-2' });
    expect(corrected.id).not.toBe(first.id);
    expect(corrected.packageHash).not.toBe(first.packageHash);
    expect(harness.repository.listEvidencePackages(harness.context, harness.missionId).map((row) => row.id))
      .toEqual(expect.arrayContaining([first.id, corrected.id]));
  });

  it('fails closed for incomplete report coverage, stale context, and another store', () => {
    const harness = createHarness({ missingReportType: 'placement' });
    expect(() => seal(harness)).toThrow(/missing required report type/i);

    const stale = { ...harness.context, sessionGeneration: 3 } as StoreContextEnvelope;
    expect(() => harness.repository.listEvidencePackages(stale, harness.missionId))
      .toThrow(AnalysisAuthorityRepositoryError);
    expect(harness.repository.getEvidencePackage(harness.otherContext, 'evidence-1')).toBeUndefined();
  });

  it('registers a hashed stable Ads authority and increments revisions without exposing proof paths', () => {
    const harness = createHarness();
    const evidence = seal(harness);
    const first = registerAuthority(harness, evidence.id);
    expect(first.entityRevision).toBe(2);
    expect(first.adEntityId).toBe('opaque-keyword-1');
    expect(JSON.stringify(first)).not.toMatch(/\.png|D:[\\/]/i);
    const second = harness.repository.registerVerifiedAdEntity(harness.context, {
      ...{
        authorityId: 'authority-2',
        evidencePackageId: evidence.id,
        adEntityId: 'opaque-keyword-1',
        entityType: 'keyword' as const,
        entityName: 'door lock',
        campaignName: 'Campaign A',
        adGroupName: 'Ad Group A',
        sourceReportType: 'keyword' as const,
        sourceFileHash: HASHES[5],
        sourceRow: 7,
        identitySource: 'ads_ui' as const,
        proofSha256: 'd'.repeat(64),
        verifiedBy: 'operator',
        verifiedAt: '2026-07-22T12:01:00.000Z',
      },
    });
    expect(second.entityRevision).toBe(3);
    expect(harness.repository.adEntityBelongsToStore(harness.context, 'opaque-keyword-1')).toBe(true);
    expect(harness.repository.adEntityBelongsToStore(harness.otherContext, 'opaque-keyword-1')).toBe(false);
  });

  it('rejects an action batch when the Mission changes while analysis is running', () => {
    const harness = createHarness();
    const evidence = seal(harness);
    const mission = harness.missionRepository.getMission(harness.context, harness.missionId)!;
    harness.missionRepository.updateMission(harness.context, {
      id: mission.id,
      expectedRevision: mission.revision,
      actorId: 'operator',
      patch: { title: 'Mission changed during analysis' },
    });

    try {
      harness.repository.createActionBatch(harness.context, {
        id: 'analysis-batch-stale-mission',
        missionId: harness.missionId,
        evidencePackageId: evidence.id,
        expectedMissionRevision: mission.revision,
      });
      throw new Error('Expected stale Mission revision rejection.');
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisAuthorityRepositoryError);
      expect((error as AnalysisAuthorityRepositoryError).code).toBe('STATE_CONFLICT');
      expect((error as Error).message).toContain('Mission changed while its analysis was running');
    }
  });

  it('creates one immutable action batch, eligible proposal, and exact Decision link', () => {
    const harness = createHarness();
    const evidence = seal(harness);
    const authority = registerAuthority(harness, evidence.id);
    const recommendationId = insertRecommendation(harness);
    const actionBatch = harness.repository.createActionBatch(harness.context, {
      id: 'analysis-batch-1',
      missionId: harness.missionId,
      evidencePackageId: evidence.id,
      expectedMissionRevision: 1,
    });
    const proposal = harness.repository.createProposalSnapshot(harness.context, {
      id: 'proposal-1',
      missionId: harness.missionId,
      evidencePackageId: evidence.id,
      actionBatchId: actionBatch.id,
      legacyRecommendationId: recommendationId,
      adEntityAuthorityId: authority.authorityId,
      validUntil: '2026-07-23T12:00:00.000Z',
    });
    expect(proposal.actionRevision).toBe(actionBatch.actionRevision);
    expect(proposal.authorization.human).toEqual({ eligible: true, blockers: [] });
    expect(proposal.authorization.policy.blockers).toContain('POLICY_RUNTIME_BLOCKED');
    expect(JSON.stringify(proposal)).not.toMatch(/\.xlsx|\.png|D:[\\/]/i);

    const decision = harness.missionRepository.createDecision(harness.context, {
      id: 'decision-1',
      missionId: harness.missionId,
      dataBatchId: proposal.dataBatchId,
      policyVersionId: proposal.policyVersionId,
      policyRevision: proposal.policyRevision,
      actionRevision: proposal.actionRevision,
      title: proposal.entityName,
      rationale: proposal.explanation,
      recommendation: 'Lower keyword bid',
      facts: [`evidence:${proposal.evidencePackageHash}`],
      alternatives: ['Keep current bid'],
      validUntil: proposal.validUntil,
      actionType: proposal.actionType,
      adEntityId: proposal.adEntityId,
      currentValue: proposal.currentBidCents / 100,
      recommendedValue: proposal.proposedBidCents / 100,
      confidence: proposal.confidence,
      status: 'needs_approval',
      actorId: 'analysis-engine',
    });
    const link = harness.repository.linkProposalDecision(harness.context, {
      id: 'proposal-decision-link-1',
      proposalId: proposal.id,
      decisionId: decision.id,
    });
    expect(link).toMatchObject({ proposalId: proposal.id, decisionId: decision.id });
  });

  it('only marks an explicit aligned rule-AI decision without review as policy eligible', () => {
    const harness = createHarness();
    enablePolicyAuto(harness);
    const evidence = seal(harness);
    const authority = registerAuthority(harness, evidence.id);
    const cases = [
      {
        name: 'explicit aligned rule-AI decision',
        patch: {},
        source: 'rule_ai',
        eligible: true,
        blockers: [],
      },
      {
        name: 'legacy dual-AI metadata without an explicit decision',
        patch: {
          decisionSource: undefined,
          decisionAgreement: undefined,
          decisionRequiresReview: undefined,
          aiStrategySource: 'ai',
          explanationSource: 'ai',
        },
        source: 'rule',
        eligible: false,
        blockers: ['POLICY_REQUIRES_RULE_AI_ALIGNMENT'],
      },
      {
        name: 'rule-AI decision without an agreement',
        patch: { decisionAgreement: undefined },
        source: 'rule',
        eligible: false,
        blockers: ['POLICY_REQUIRES_RULE_AI_ALIGNMENT'],
      },
      {
        name: 'conflicting rule-AI decision metadata',
        patch: { decisionAgreement: 'conflict' },
        source: 'rule',
        eligible: false,
        blockers: ['AI_RULE_CONFLICT', 'POLICY_REQUIRES_RULE_AI_ALIGNMENT'],
      },
      {
        name: 'aligned decision that still requires review',
        patch: { decisionRequiresReview: true },
        source: 'rule',
        eligible: false,
        blockers: ['REVIEW_REQUIRED', 'POLICY_REQUIRES_RULE_AI_ALIGNMENT'],
      },
    ] as const;

    const results = cases.map((testCase, index) => {
      const recommendationId = insertRecommendation(harness, testCase.patch);
      const actionBatch = harness.repository.createActionBatch(harness.context, {
        id: `analysis-source-batch-${index + 1}`,
        missionId: harness.missionId,
        evidencePackageId: evidence.id,
        expectedMissionRevision: 1,
      });
      const proposal = harness.repository.createProposalSnapshot(harness.context, {
        id: `analysis-source-proposal-${index + 1}`,
        missionId: harness.missionId,
        evidencePackageId: evidence.id,
        actionBatchId: actionBatch.id,
        legacyRecommendationId: recommendationId,
        adEntityAuthorityId: authority.authorityId,
        validUntil: '2026-07-23T12:00:00.000Z',
      });
      return {
        name: testCase.name,
        source: proposal.source,
        eligible: proposal.authorization.policy.eligible,
        blockers: proposal.authorization.policy.blockers,
      };
    });

    expect(results).toEqual(cases.map((testCase) => ({
      name: testCase.name,
      source: testCase.source,
      eligible: testCase.eligible,
      blockers: testCase.blockers,
    })));
  });

  it('never makes rule fallback or unverified display identity grant-eligible', () => {
    const harness = createHarness();
    const evidence = seal(harness);
    const recommendationId = insertRecommendation(harness, {
      writableTarget: undefined,
      aiFallbackReason: 'provider unavailable',
      decisionSource: 'rule',
    });
    const actionBatch = harness.repository.createActionBatch(harness.context, {
      id: 'analysis-batch-1',
      missionId: harness.missionId,
      evidencePackageId: evidence.id,
      expectedMissionRevision: 1,
    });
    const proposal = harness.repository.createProposalSnapshot(harness.context, {
      id: 'proposal-1',
      missionId: harness.missionId,
      evidencePackageId: evidence.id,
      actionBatchId: actionBatch.id,
      legacyRecommendationId: recommendationId,
      validUntil: '2026-07-23T12:00:00.000Z',
    });
    expect(proposal.authorization.human.eligible).toBe(false);
    expect(proposal.authorization.human.blockers).toEqual(expect.arrayContaining([
      'MISSING_STABLE_AD_ENTITY',
      'RULE_FALLBACK_NOT_AUTHORIZABLE',
    ]));
    expect(proposal.authorization.policy.eligible).toBe(false);
  });

  it('rejects non-keyword recommendation entities in the V1 proposal contract', () => {
    const harness = createHarness();
    const evidence = seal(harness);
    const recommendationId = insertRecommendation(harness, {
      reportType: 'product_targeting',
      writableTarget: {
        entityType: 'product_targeting',
        entityId: 'opaque-product-target-1',
        entityName: 'asin="B0OTHER"',
        campaignName: 'Campaign A',
        adGroupName: 'Ad Group A',
        metricDate: '2026-07-22',
        sourceFile: 'D:/reports/product_targeting.xlsx',
        sourceRow: 7,
        identitySource: 'ads_ui',
        verifiedBy: 'operator',
        verifiedAt: NOW,
        verificationNote: 'visible product target row matched',
        identityProofPath: 'D:/proof/product-target.png',
      },
    });
    const actionBatch = harness.repository.createActionBatch(harness.context, {
      id: 'analysis-batch-non-keyword',
      missionId: harness.missionId,
      evidencePackageId: evidence.id,
      expectedMissionRevision: 1,
    });
    try {
      harness.repository.createProposalSnapshot(harness.context, {
        id: 'proposal-non-keyword',
        missionId: harness.missionId,
        evidencePackageId: evidence.id,
        actionBatchId: actionBatch.id,
        legacyRecommendationId: recommendationId,
        validUntil: '2026-07-23T12:00:00.000Z',
      });
      throw new Error('Expected non-keyword proposal rejection.');
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisAuthorityRepositoryError);
      expect((error as AnalysisAuthorityRepositoryError).code).toBe('UNSUPPORTED_ACTION');
    }
  });
});
