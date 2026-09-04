import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type MissionRecord,
  type PolicyVersionRules,
  type PolicyVersionRecord,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import {
  MissionDomainRepository,
  MissionDomainRepositoryError,
  type MissionDomainRepositoryErrorCode,
} from './mission-domain-repo';

const NOW = '2026-07-22T12:00:00.000Z';
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
  databasePath: string;
  database: Database.Database;
  repository: MissionDomainRepository;
  contextOne: StoreContextEnvelope;
  contextTwo: StoreContextEnvelope;
}

function createHarness(now: () => Date = () => new Date(NOW)): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-mission-repo-'));
  tempDirs.push(directory);
  const databasePath = path.join(directory, 'app.db');
  const database = initSqlite(databasePath);
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
      ) VALUES (?, '2026-07-21', '2026-07-21', ?, 'US', 'completed',
        ?, ?, ?, ?, ?, ?, '2026-07-21', 4)
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

  const contextOne = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  const contextTwo = normalizeStoreContextEnvelope({
    storeId: 'store-two',
    browserProfileId: 'profile-two',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  seedDefaultPolicyScopeAuthority(database, contextOne);
  seedDefaultPolicyScopeAuthority(database, contextTwo);
  const repository = new MissionDomainRepository(database, {
    now,
    references: {
      productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
      adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
      adEntitySupportsKeywordBid: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
    },
  });
  return { databasePath, database, repository, contextOne, contextTwo };
}

const policyRules = (storeId: string): PolicyVersionRules => ({
  allowedActionTypes: ['set_keyword_bid'],
  allowedAdEntityIds: [`${storeId}-keyword-1`],
  maxChangePct: 10,
  totalImpactBudget: 50,
  maxDailyActionCount: 100,
  cooldownMinutes: 0,
  executionWindow: {
    timeZone: 'America/Los_Angeles',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    start: '00:00',
    end: '23:59',
  },
  requiredEvidence: [
    'page_identity',
    'before_screenshot',
    'after_screenshot',
    'reload_screenshot',
    'readback_value',
  ],
  stopConditions: [
    { code: 'identity_drift', detail: 'Stop when store or entity identity drifts.' },
    { code: 'expected_before_mismatch', detail: 'Stop when the before value changed.' },
    { code: 'unknown_result', detail: 'Stop when the write outcome is unknown.' },
    { code: 'data_stale', detail: 'Stop when source data is stale.' },
    { code: 'impact_budget_exhausted', detail: 'Stop when the batch budget is exhausted.' },
    { code: 'kill_switch', detail: 'Stop when the store kill switch is enabled.' },
  ],
  killSwitch: false,
});

function seedProductScopeAuthorityWithOnlyUnrelatedMetric(
  database: Database.Database,
  context: StoreContextEnvelope,
  options: {
    lineageKey?: string;
    entityId?: string;
    entityName?: string;
    campaignName?: string;
    adGroupName?: string;
    bindReportFile?: boolean;
  } = {},
): {
  exactFile: string;
  exactRow: number;
  entityId: string;
  authorityId: string;
  authorityProofSha256: string;
  evidenceId: string;
  sourceFileHash: string;
  sourceRow: number;
} {
  const lineageKey = options.lineageKey ?? 'scope';
  const batchId = `batch-${context.storeId}`;
  const runId = `scope-run-${lineageKey}-${context.storeId}`;
  const policyId = `scope-support-policy-${lineageKey}-${context.storeId}`;
  const policyVersionId = `scope-support-version-${lineageKey}-${context.storeId}`;
  const missionId = `scope-support-mission-${lineageKey}-${context.storeId}`;
  const evidenceId = `scope-evidence-${lineageKey}-${context.storeId}`;
  const entityId = options.entityId ?? `${context.storeId}-keyword-scope`;
  const entityName = options.entityName ?? 'exact keyword';
  const campaignName = options.campaignName ?? 'Exact Campaign';
  const adGroupName = options.adGroupName ?? 'Exact Ad Group';
  const authorityId = `scope-authority-${lineageKey}-${context.storeId}`;
  const authorityProofSha256 = 'f'.repeat(64);
  const exactFile = `C:/reports/${context.storeId}/${lineageKey}/keyword.xlsx`;
  const exactRow = 41;
  const fileHash = 'a'.repeat(64);
  const packageHashSeed = [...lineageKey]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('') || '0';
  const packageHash = packageHashSeed.repeat(Math.ceil(64 / packageHashSeed.length)).slice(0, 64);

  database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'completed', 1, 1, 1, ?, ?, ?)
  `).run(context.storeId, runId, `scope-idempotency-${lineageKey}-${context.storeId}`, 'b'.repeat(64), batchId, NOW, NOW, NOW);
  const reportFileId = Number(database.prepare(`
    INSERT INTO report_files (
      store_id, batch_id, report_type, file_path, file_name, file_size,
      status, imported_rows, file_hash, last_imported_at
    ) VALUES (?, ?, 'keyword', ?, 'keyword.xlsx', 1024, 'imported', 1, ?, ?)
  `).run(context.storeId, batchId, exactFile, fileHash, NOW).lastInsertRowid);
  database.prepare(`
    INSERT INTO report_import_file_snapshots (
      store_id, snapshot_id, run_id, batch_id, report_file_id, report_type, file_path,
      file_name, file_size_bytes, file_hash, imported_rows, captured_at
    ) VALUES (?, ?, ?, ?, ?, 'keyword', ?, 'keyword.xlsx', 1024, ?, 1, ?)
  `).run(
    context.storeId,
    `scope-snapshot-${lineageKey}-${context.storeId}`,
    runId,
    batchId,
    options.bindReportFile === false ? null : reportFileId,
    exactFile,
    fileHash,
    NOW,
  );
  database.prepare(`
    INSERT INTO policies (
      id, store_id, name, scope, status, priority, active_version_id,
      revision, created_at, updated_at
    ) VALUES (?, ?, 'Scope support policy', 'store', 'archived', 1, NULL, 1, ?, ?)
  `).run(policyId, context.storeId, NOW, NOW);
  database.prepare(`
    INSERT INTO policy_versions (
      id, store_id, policy_id, version, status, rules_json, revision,
      created_at, updated_at, enabled_at
    ) VALUES (?, ?, ?, 1, 'enabled', '{}', 1, ?, ?, ?)
  `).run(policyVersionId, context.storeId, policyId, NOW, NOW, NOW);
  database.prepare('UPDATE policies SET active_version_id = ? WHERE store_id = ? AND id = ?')
    .run(policyVersionId, context.storeId, policyId);
  database.prepare(`
    INSERT INTO missions (
      id, store_id, marketplace, currency, business_date,
      created_session_generation, data_batch_id, policy_version_id,
      title, objective, status, phase, priority, observation_starts_at,
      observation_ends_at, success_criteria_json, guardrails_json, revision,
      created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, 'Scope support mission',
      'Prove exact product authority', 'archived', 'decision', 'P1', ?, ?,
      '[]', '[]', 1, ?, ?)
  `).run(
    missionId,
    context.storeId,
    context.businessDate,
    context.sessionGeneration,
    batchId,
    policyVersionId,
    NOW,
    '2026-07-30T12:00:00.000Z',
    NOW,
    NOW,
  );
  database.prepare(`
    INSERT INTO analysis_evidence_packages (
      id, store_id, marketplace, currency, mission_id, data_batch_id,
      import_run_id, date_from, date_to, asin, report_types_json, sources_json,
      metric_row_count, reconciliation_hash, rule_revision, model_revision,
      package_hash, imported_at, fresh_until, sealed_at,
      created_session_generation
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, '2026-07-21', '2026-07-21', NULL,
      '["keyword"]', '[]', 1, ?, ?, 'model-test', ?, ?, ?, ?, ?)
  `).run(
    evidenceId,
    context.storeId,
    missionId,
    batchId,
    runId,
    'c'.repeat(64),
    'd'.repeat(64),
    packageHash,
    NOW,
    '2026-07-30T12:00:00.000Z',
    NOW,
    context.sessionGeneration,
  );
  database.prepare(`
    INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type,
      entity_name, campaign_name, ad_group_name, evidence_package_id,
      source_report_type, source_file_hash, source_row, identity_source,
      proof_sha256, verified_by, verified_at, created_at
    ) VALUES (?, ?, ?, 1, 'keyword', ?, ?, ?, ?, 'keyword', ?, ?,
      'ads_ui', ?, 'operator', ?, ?)
  `).run(
    authorityId,
    context.storeId,
    entityId,
    entityName,
    campaignName,
    adGroupName,
    evidenceId,
    fileHash,
    exactRow,
    authorityProofSha256,
    NOW,
    NOW,
  );
  database.prepare(`
    INSERT INTO ad_daily_metrics (
      batch_id, report_type, date, store_name, marketplace_code, asin,
      campaign_name, ad_group_name, targeting, source_file, source_row,
      store_id, store_authority_quarantined
    ) VALUES (?, 'keyword', '2026-07-21', 'US Store One', 'US', 'B0WRONGROW',
      ?, ?, ?, 'C:/reports/unrelated.xlsx', 999, ?, 0)
  `).run(batchId, campaignName, adGroupName, entityName, context.storeId);
  return {
    exactFile,
    exactRow,
    entityId,
    authorityId,
    authorityProofSha256,
    evidenceId,
    sourceFileHash: fileHash,
    sourceRow: exactRow,
  };
}

function seedAdditionalPolicyScopeAuthority(
  database: Database.Database,
  context: StoreContextEnvelope,
  base: {
    evidenceId: string;
    sourceFileHash: string;
    sourceRow: number;
  },
  input: {
    entityId: string;
    entityName: string;
    campaignName: string;
    adGroupName: string;
    sourceRow?: number;
  },
): {
  entityId: string;
  authorityId: string;
  authorityProofSha256: string;
} {
  const authorityId = `scope-authority-${context.storeId}-${input.entityId}`;
  const authorityProofSha256 = '9'.repeat(64);
  database.prepare(`
    INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type,
      entity_name, campaign_name, ad_group_name, evidence_package_id,
      source_report_type, source_file_hash, source_row, identity_source,
      proof_sha256, verified_by, verified_at, created_at
    ) VALUES (?, ?, ?, 1, 'keyword', ?, ?, ?, ?, 'keyword', ?, ?,
      'ads_ui', ?, 'operator', ?, ?)
  `).run(
    authorityId,
    context.storeId,
    input.entityId,
    input.entityName,
    input.campaignName,
    input.adGroupName,
    base.evidenceId,
    base.sourceFileHash,
    input.sourceRow ?? base.sourceRow,
    authorityProofSha256,
    NOW,
    NOW,
  );
  return { entityId: input.entityId, authorityId, authorityProofSha256 };
}

function seedExactPolicyAuthorityMetric(
  database: Database.Database,
  context: StoreContextEnvelope,
  input: {
    sourceFile: string;
    sourceRow: number;
    entityName: string;
    campaignName: string;
    adGroupName: string;
    asin?: string;
  },
): void {
  database.prepare(`
    INSERT INTO ad_daily_metrics (
      batch_id, report_type, date, store_name, marketplace_code, asin,
      campaign_name, ad_group_name, targeting, source_file, source_row,
      clicks, cost, orders, sales, acos, cvr, currency,
      store_id, store_authority_quarantined
    ) VALUES (
      ?, 'keyword', '2026-07-21', ?, 'US', ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, 0
    )
  `).run(
    `batch-${context.storeId}`,
    context.storeId,
    input.asin ?? `${context.storeId}-product-1`,
    input.campaignName,
    input.adGroupName,
    input.entityName,
    input.sourceFile,
    input.sourceRow,
    10,
    20,
    2,
    50,
    0.4,
    0.2,
    'USD',
    context.storeId,
  );
}

function seedDefaultPolicyScopeAuthority(
  database: Database.Database,
  context: StoreContextEnvelope,
): void {
  const first = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, context, {
    lineageKey: 'baseline',
    entityId: `${context.storeId}-keyword-1`,
    entityName: 'baseline keyword 1',
    campaignName: 'Baseline Campaign 1',
    adGroupName: 'Baseline Ad Group 1',
  });
  seedExactPolicyAuthorityMetric(database, context, {
    sourceFile: first.exactFile,
    sourceRow: first.sourceRow,
    entityName: 'baseline keyword 1',
    campaignName: 'Baseline Campaign 1',
    adGroupName: 'Baseline Ad Group 1',
  });
  seedAdditionalPolicyScopeAuthority(database, context, first, {
    entityId: `${context.storeId}-keyword-2`,
    entityName: 'baseline keyword 2',
    campaignName: 'Baseline Campaign 2',
    adGroupName: 'Baseline Ad Group 2',
    sourceRow: first.sourceRow + 1,
  });
  seedExactPolicyAuthorityMetric(database, context, {
    sourceFile: first.exactFile,
    sourceRow: first.sourceRow + 1,
    entityName: 'baseline keyword 2',
    campaignName: 'Baseline Campaign 2',
    adGroupName: 'Baseline Ad Group 2',
    asin: `${context.storeId}-product-2`,
  });
}

function seedExperimentObservationAuthority(
  database: Database.Database,
  context: StoreContextEnvelope,
  input: {
    missionId: string;
    productId: string;
    adEntityId: string;
    clicks: number;
    cost: number;
    orders: number;
    sales: number;
  },
): string {
  const batchId = `experiment-result-batch-${context.storeId}`;
  const runId = `experiment-result-run-${context.storeId}`;
  const evidenceId = `experiment-result-evidence-${context.storeId}`;
  const filePath = `C:/reports/${context.storeId}/experiment-result/keyword.xlsx`;
  const fileHash = '7'.repeat(64);
  const sourceRow = 51;
  const completedAt = '2026-07-30T10:00:00.000Z';
  database.prepare(`
    INSERT INTO lingxing_report_batches (
      id, date_start, date_end, store_name, marketplace_code, status,
      download_dir, created_at, completed_at, store_id, request_id,
      browser_profile_id, business_date, session_generation
    ) VALUES (?, '2026-07-29', '2026-07-30', 'US Store One', 'US', 'completed',
      ?, ?, ?, ?, ?, ?, '2026-07-30', ?)
  `).run(
    batchId,
    `logical-download:${batchId}`,
    completedAt,
    completedAt,
    context.storeId,
    `request-${batchId}`,
    context.browserProfileId,
    context.sessionGeneration,
  );
  database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'completed', 1, 1, 1, ?, ?, ?)
  `).run(
    context.storeId,
    runId,
    `idempotency-${runId}`,
    '6'.repeat(64),
    batchId,
    completedAt,
    completedAt,
    completedAt,
  );
  const reportFileId = Number(database.prepare(`
    INSERT INTO report_files (
      store_id, batch_id, report_type, file_path, file_name, file_size,
      status, imported_rows, file_hash, last_imported_at
    ) VALUES (?, ?, 'keyword', ?, 'keyword.xlsx', 1024, 'imported', 1, ?, ?)
  `).run(context.storeId, batchId, filePath, fileHash, completedAt).lastInsertRowid);
  database.prepare(`
    INSERT INTO report_import_file_snapshots (
      store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
      file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
    ) VALUES (?, ?, ?, ?, ?, 'keyword', ?, 'keyword.xlsx', 1024, ?, 1, ?)
  `).run(
    context.storeId,
    `snapshot-${runId}`,
    runId,
    batchId,
    reportFileId,
    filePath,
    fileHash,
    completedAt,
  );
  database.prepare(`
    INSERT INTO analysis_evidence_packages (
      id, store_id, marketplace, currency, mission_id, data_batch_id,
      import_run_id, date_from, date_to, asin, report_types_json, sources_json,
      metric_row_count, reconciliation_hash, rule_revision, model_revision,
      package_hash, imported_at, fresh_until, sealed_at,
      created_session_generation
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, '2026-07-29', '2026-07-30', ?,
      '["keyword"]', '[]', 1, ?, ?, 'model-test', ?, ?, ?, ?, ?)
  `).run(
    evidenceId,
    context.storeId,
    input.missionId,
    batchId,
    runId,
    input.productId,
    '5'.repeat(64),
    '4'.repeat(64),
    '3'.repeat(64),
    completedAt,
    '2026-08-06T10:00:00.000Z',
    completedAt,
    context.sessionGeneration,
  );
  database.prepare(`
    INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type,
      entity_name, campaign_name, ad_group_name, evidence_package_id,
      source_report_type, source_file_hash, source_row, identity_source,
      proof_sha256, verified_by, verified_at, created_at
    ) VALUES (?, ?, ?, 2, 'keyword', 'baseline keyword 1', 'Baseline Campaign 1',
      'Baseline Ad Group 1', ?, 'keyword', ?, ?, 'ads_ui', ?, 'operator', ?, ?)
  `).run(
    `experiment-result-authority-${context.storeId}`,
    context.storeId,
    input.adEntityId,
    evidenceId,
    fileHash,
    sourceRow,
    '2'.repeat(64),
    completedAt,
    completedAt,
  );
  database.prepare(`
    INSERT INTO ad_daily_metrics (
      batch_id, report_type, date, store_name, marketplace_code, asin,
      campaign_name, ad_group_name, targeting, source_file, source_row,
      clicks, cost, orders, sales, acos, cvr, currency,
      store_id, store_authority_quarantined
    ) VALUES (?, 'keyword', '2026-07-30', 'US Store One', 'US', ?,
      'Baseline Campaign 1', 'Baseline Ad Group 1', 'baseline keyword 1', ?, ?,
      ?, ?, ?, ?, ?, ?, 'USD', ?, 0)
  `).run(
    batchId,
    input.productId,
    filePath,
    sourceRow,
    input.clicks,
    input.cost,
    input.orders,
    input.sales,
    input.sales > 0 ? input.cost / input.sales : 0,
    input.clicks > 0 ? input.orders / input.clicks : 0,
    context.storeId,
  );
  return batchId;
}

function seedCanonicalPolicyIdentity(
  database: Database.Database,
  context: StoreContextEnvelope,
  authority: {
    entityId: string;
    authorityId: string;
    authorityProofSha256: string;
  },
  input: {
    adsAccountId?: string;
    campaignId: string;
    adGroupId: string;
    entityRevision?: number;
    objectRevision?: number;
    canonicalKeywordId?: string;
    resolvedSessionGeneration?: number;
  },
): void {
  const entityRevision = input.entityRevision ?? 1;
  const objectRevision = input.objectRevision ?? 1;
  const canonicalKeywordId = input.canonicalKeywordId ?? `canonical-${context.storeId}-keyword-1`;
  database.prepare(`
    INSERT INTO ad_keyword_identity_versions (
      identity_version_id, store_id, marketplace, currency,
      canonical_keyword_id, ad_entity_id, entity_revision, ads_account_id,
      campaign_id, ad_group_id, keyword_id, object_revision,
      observed_bid_cents, page_identity_hash, source_authority_id,
      source_authority_proof_sha256, resolution_proof_sha256,
      resolved_session_generation, resolved_at, resolved_by, created_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, ?, ?, 232,
      ?, ?, ?, ?, ?, ?, 'operator', ?)
  `).run(
    `scope-identity-${context.storeId}-${canonicalKeywordId}-${entityRevision}-${objectRevision}`,
    context.storeId,
    canonicalKeywordId,
    authority.entityId,
    entityRevision,
    input.adsAccountId ?? `ads-account-${context.storeId}`,
    input.campaignId,
    input.adGroupId,
    `keyword-id-${context.storeId}`,
    objectRevision,
    '1'.repeat(64),
    authority.authorityId,
    authority.authorityProofSha256,
    '2'.repeat(64),
    input.resolvedSessionGeneration ?? context.sessionGeneration,
    NOW,
    NOW,
  );
}

const EXACT_EIGHT_REPORT_TYPES = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
] as const;

function seedExactEightImportedBatch(
  database: Database.Database,
  context: StoreContextEnvelope,
  input: { batchId: string; requestId: string },
): void {
  const runId = `full8-import-${input.batchId}`;
  database.prepare(`
    INSERT INTO lingxing_report_batches (
      id, date_start, date_end, store_name, marketplace_code, status,
      download_dir, created_at, completed_at, store_id, request_id,
      browser_profile_id, business_date, session_generation
    ) VALUES (?, '2026-07-21', '2026-07-21', 'US Store One', 'US', 'completed',
      ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.batchId,
    `logical-download:${input.batchId}`,
    NOW,
    NOW,
    context.storeId,
    input.requestId,
    context.browserProfileId,
    context.businessDate,
    context.sessionGeneration,
  );
  database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'completed', 8, 8, 8, ?, ?, ?)
  `).run(
    context.storeId,
    runId,
    `full8:${input.batchId}`,
    'd'.repeat(64),
    input.batchId,
    NOW,
    NOW,
    NOW,
  );
  for (const [index, reportType] of EXACT_EIGHT_REPORT_TYPES.entries()) {
    const filePath = `C:/reports/${input.batchId}/${reportType}.xlsx`;
    const fileHash = String(index + 1).repeat(64).slice(0, 64);
    const fileId = Number(database.prepare(`
      INSERT INTO report_files (
        store_id, batch_id, report_type, file_path, file_name, file_size,
        status, imported_rows, file_hash, last_imported_at
      ) VALUES (?, ?, ?, ?, ?, 1024, 'imported', 1, ?, ?)
    `).run(
      context.storeId,
      input.batchId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      fileHash,
      NOW,
    ).lastInsertRowid);
    database.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
        file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1024, ?, 1, ?)
    `).run(
      context.storeId,
      `full8-snapshot-${input.batchId}-${reportType}`,
      runId,
      input.batchId,
      fileId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      fileHash,
      NOW,
    );
  }
}

function seedSucceededProductionFullCollectionRoot(
  database: Database.Database,
  context: StoreContextEnvelope,
  input: { batchId: string; requestId: string },
): void {
  const request = {
    requestId: input.requestId,
    storeContext: context,
    dateStart: '2026-07-21',
    dateEnd: '2026-07-21',
    mode: 'create-and-download' as const,
    reportTypes: EXACT_EIGHT_REPORT_TYPES,
  };
  const reports = EXACT_EIGHT_REPORT_TYPES.map((reportType) => ({
    reportType,
    state: 'downloaded' as const,
    attemptIndex: 0,
    autoRetryCount: 0,
    fileSizeBytes: 1024,
    updatedAt: NOW,
  }));
  const snapshot = {
    jobId: input.batchId,
    request,
    lineage: {
      lineageId: input.batchId,
      rootJobId: input.batchId,
      expectedReportTypes: EXACT_EIGHT_REPORT_TYPES,
      purpose: 'production_full' as const,
    },
    state: 'completed' as const,
    reports,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
    importState: 'succeeded' as const,
    importAttemptedAt: NOW,
    importCompletedAt: NOW,
  };
  database.prepare(`
    INSERT INTO lingxing_collection_jobs (
      store_id, job_id, request_id, browser_profile_id, marketplace, currency,
      business_timezone, business_date, session_generation, date_start, date_end,
      mode, report_types_json, state, snapshot_json, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 'US', 'USD', ?, ?, ?, '2026-07-21', '2026-07-21',
      'create-and-download', ?, 'completed', ?, ?, ?, ?)
  `).run(
    context.storeId,
    input.batchId,
    input.requestId,
    context.browserProfileId,
    context.businessTimezone,
    context.businessDate,
    context.sessionGeneration,
    JSON.stringify(EXACT_EIGHT_REPORT_TYPES),
    JSON.stringify(snapshot),
    NOW,
    NOW,
    NOW,
  );
  const insertCheckpoint = database.prepare(`
    INSERT INTO lingxing_collection_report_checkpoints (
      store_id, job_id, report_type, state, attempt_index, auto_retry_count,
      file_size_bytes, updated_at
    ) VALUES (?, ?, ?, 'downloaded', 0, 0, 1024, ?)
  `);
  for (const reportType of EXACT_EIGHT_REPORT_TYPES) {
    insertCheckpoint.run(context.storeId, input.batchId, reportType, NOW);
  }
}

function seedEnabledPolicy(
  repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  rules = policyRules(context.storeId),
) {
  const policy = repository.createPolicy(context, {
    id: `policy-${context.storeId}`,
    name: 'Keyword bid policy',
    scope: 'sponsored-products-keywords',
    priority: 100,
    actorId: 'operator-one',
  });
  const draftVersion = repository.createPolicyVersion(context, {
    id: `policy-version-${context.storeId}-1`,
    policyId: policy.id,
    version: 1,
    rules,
    validUntil: '2026-08-01T00:00:00.000Z',
    actorId: 'operator-one',
  });
  const version = repository.enablePolicyVersion(context, {
    policyId: policy.id,
    versionId: draftVersion.id,
    expectedPolicyRevision: policy.revision,
    expectedVersionRevision: draftVersion.revision,
    actorId: 'operator-one',
  });
  return {
    policy: repository.getPolicy(context, policy.id)!,
    version,
  };
}

function seedActiveMission(repository: MissionDomainRepository, context: StoreContextEnvelope) {
  const authority = seedEnabledPolicy(repository, context);
  const draft = repository.createMission(context, {
    id: `mission-${context.storeId}`,
    dataBatchId: `batch-${context.storeId}`,
    policyVersionId: authority.version.id,
    title: 'Reduce inefficient keyword spend',
    objective: 'Reduce ACOS without losing attributed sales.',
    priority: 'P1',
    productId: `${context.storeId}-product-1`,
    observationStartsAt: '2026-07-22T00:00:00.000Z',
    observationEndsAt: '2026-07-29T00:00:00.000Z',
    successCriteria: ['ACOS improves by at least 2 points'],
    guardrails: ['Attributed sales decline stays below 5%'],
    actorId: 'operator-one',
  });
  const mission = repository.transitionMission(context, {
    id: draft.id,
    expectedRevision: draft.revision,
    status: 'active',
    phase: 'analysis',
    actorId: 'operator-one',
    reason: 'Facts reviewed.',
  });
  return { ...authority, mission };
}

function createApprovedDecision(
  repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  mission: MissionRecord,
  version: PolicyVersionRecord,
  actionRevision: number,
  validUntil = '2026-07-23T00:00:00.000Z',
  entityOrdinal = '1',
) {
  const decisionId = entityOrdinal === '1'
    ? `decision-${context.storeId}-${actionRevision}`
    : `decision-${context.storeId}-${actionRevision}-${entityOrdinal}`;
  const decision = repository.createDecision(context, {
    id: decisionId,
    missionId: mission.id,
    dataBatchId: mission.dataBatchId,
    policyVersionId: version.id,
    policyRevision: version.revision,
    actionRevision,
    title: `Approved keyword action ${actionRevision}`,
    rationale: 'The observed facts support a bounded keyword bid change.',
    recommendation: 'Apply the bounded bid change and verify by reload.',
    facts: ['Completed store-scoped report batch is available.'],
    alternatives: ['Keep the current bid and continue observing.'],
    expectedEffect: 'Reduce inefficient spend.',
    validUntil,
    actionType: 'set_keyword_bid',
    adEntityId: `${context.storeId}-keyword-${entityOrdinal}`,
    currentValue: 1,
    recommendedValue: 0.94,
    confidence: 0.8,
    status: 'needs_approval',
    actorId: 'ai-analyst',
  });
  expect(decision.productId).toBe(mission.productId);
  return repository.resolveDecision(context, {
    id: decision.id,
    expectedRevision: decision.revision,
    status: 'approved',
    actorId: 'operator-one',
    reason: 'Approved within the immutable policy envelope.',
  });
}

function seedVerifiedReadbackDecision(
  repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  mission: MissionRecord,
  version: PolicyVersionRecord,
  options: { withEvidenceCheckpoint?: boolean } = {},
) {
  const approved = createApprovedDecision(repository, context, mission, version, 1);
  const executed = repository.resolveDecision(context, {
    id: approved.id,
    expectedRevision: approved.revision,
    status: 'executed',
    actorId: 'executor-one',
    reason: 'Durable submit intent and after evidence recorded.',
  });
  const verified = repository.resolveDecision(context, {
    id: executed.id,
    expectedRevision: executed.revision,
    status: 'verified',
    actorId: 'executor-one',
    reason: 'Independent reload readback matched the target bid.',
  });
  const readbackMission = repository.transitionMission(context, {
    id: mission.id,
    expectedRevision: mission.revision,
    status: 'active',
    phase: 'readback',
    actorId: 'executor-one',
    reason: 'Execution completed with independent reload readback.',
  });
  if (options.withEvidenceCheckpoint !== false) {
    repository.appendMissionCheckpoint(context, {
      id: `readback-checkpoint-${mission.id}`,
      missionId: mission.id,
      stage: 'READBACK',
      title: '广告执行回读',
      status: 'verified',
      evidenceCount: 3,
      actorId: 'executor-one',
    });
  }
  return { decision: verified, mission: readbackMission };
}

function expectRepositoryError(
  action: () => unknown,
  code: MissionDomainRepositoryErrorCode,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MissionDomainRepositoryError);
    expect((error as MissionDomainRepositoryError).code).toBe(code);
    return;
  }
  throw new Error(`Expected MissionDomainRepositoryError ${code}.`);
}

describe('MissionDomainRepository policy and context authority', () => {
  it('resolves the lowest numeric matching policy independent of enable order and fails closed on a tie', () => {
    const { repository, contextOne } = createHarness();
    const enable = (id: string, priority: number) => {
      const policy = repository.createPolicy(contextOne, {
        id: `priority-policy-${id}`,
        name: `Priority policy ${id}`,
        scope: 'store',
        priority,
        actorId: 'operator-one',
      });
      const draft = repository.createPolicyVersion(contextOne, {
        id: `priority-policy-${id}-v1`,
        policyId: policy.id,
        version: 1,
        rules: policyRules(contextOne.storeId),
        validUntil: '2026-08-01T00:00:00.000Z',
        actorId: 'operator-one',
      });
      return repository.enablePolicyVersion(contextOne, {
        policyId: policy.id,
        versionId: draft.id,
        expectedPolicyRevision: policy.revision,
        expectedVersionRevision: draft.revision,
        actorId: 'operator-one',
      });
    };

    const lowerPriority = enable('first-enabled-low-number', 10);
    enable('last-enabled-high-number', 100);
    expect(repository.getPolicyRuntime(contextOne).activePolicyVersionId)
      .toBe('priority-policy-last-enabled-high-number-v1');
    expect(repository.resolveEffectivePolicyVersion(contextOne, {
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [`${contextOne.storeId}-keyword-1`],
      at: NOW,
    }).id).toBe(lowerPriority.id);

    enable('same-low-number', 10);
    expectRepositoryError(() => repository.resolveEffectivePolicyVersion(contextOne, {
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [`${contextOne.storeId}-keyword-1`],
      at: NOW,
    }), 'STATE_CONFLICT');
  });

  it('rejects a V1 policy version whose persisted bid-change boundary exceeds ten percent', () => {
    const { repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-ten-percent',
      name: 'Ten percent hard boundary',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-ten-percent-v1-invalid',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), maxChangePct: 11 },
      actorId: 'operator-one',
    }), 'INVALID_INPUT');
    const valid = repository.createPolicyVersion(contextOne, {
      id: 'policy-ten-percent-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), maxChangePct: 10 },
      actorId: 'operator-one',
    });
    expect(valid.rules.maxChangePct).toBe(10);
  });

  it('requires backend-proven keyword authority even for a store-wide V1 policy', () => {
    const { database, contextOne } = createHarness();
    const repository = new MissionDomainRepository(database, {
      now: () => new Date(NOW),
      references: {
        productBelongsToStore: () => true,
        adEntityBelongsToStore: () => true,
        adEntitySupportsKeywordBid: () => false,
      },
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-backend-proof',
      name: 'Keyword proof required',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-backend-proof-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
  });

  it('freezes policy scope after any version exists while keeping metadata editable', () => {
    const { repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-frozen-scope',
      name: 'Frozen scope policy',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });
    repository.createPolicyVersion(contextOne, {
      id: 'policy-frozen-scope-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.updatePolicy(contextOne, {
      id: policy.id,
      expectedRevision: policy.revision,
      actorId: 'operator-one',
      patch: { scope: `keyword:${contextOne.storeId}-keyword-1` },
    }), 'STATE_CONFLICT');
    const renamed = repository.updatePolicy(contextOne, {
      id: policy.id,
      expectedRevision: policy.revision,
      actorId: 'operator-one',
      patch: { name: 'Renamed without scope drift', scope: policy.scope, priority: 4 },
    });
    expect(renamed).toMatchObject({ name: 'Renamed without scope drift', scope: 'store', priority: 4 });
  });

  it('revalidates the policy scope allowlist at version create, update and enable boundaries', () => {
    const { database, repository, contextOne } = createHarness();
    const inScopeId = `${contextOne.storeId}-keyword-1`;
    const outOfScopeId = `${contextOne.storeId}-keyword-2`;
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-scope',
      name: 'One keyword only',
      scope: `keyword:${inScopeId}`,
      priority: 5,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-scope-v1-invalid',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [outOfScopeId] },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-scope-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [inScopeId] },
      actorId: 'operator-one',
    });
    expectRepositoryError(() => repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      actorId: 'operator-one',
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [outOfScopeId] },
    }), 'REFERENCE_CONFLICT');

    database.prepare('UPDATE policy_versions SET rules_json = ? WHERE store_id = ? AND id = ?')
      .run(JSON.stringify({ ...policyRules(contextOne.storeId), allowedAdEntityIds: [outOfScopeId] }), contextOne.storeId, draft.id);
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

  it('holds an IMMEDIATE lock while validating create and update policy authority', () => {
    const { database, databasePath, contextOne } = createHarness();
    const competing = new Database(databasePath);
    databases.push(competing);
    competing.pragma('busy_timeout = 0');
    let lockProbeCount = 0;
    const repository = new MissionDomainRepository(database, {
      now: () => new Date(NOW),
      references: {
        productBelongsToStore: () => true,
        adEntityBelongsToStore: () => true,
        adEntitySupportsKeywordBid: () => {
          lockProbeCount += 1;
          expect(() => competing.prepare(`
            UPDATE policies SET priority = priority + 1
            WHERE store_id = ? AND id = ?
          `).run(contextOne.storeId, 'policy-version-lock')).toThrow(/locked/i);
          return true;
        },
      },
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-version-lock',
      name: 'Version validation lock',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-version-lock-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator-one',
    });
    repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...draft.rules, cooldownMinutes: 30 },
      actorId: 'operator-one',
    });
    expect(lockProbeCount).toBe(2);
  });

  it('does not expose store or advertising object IDs in attribution failures', () => {
    const { repository, contextOne, contextTwo } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-no-id-leak',
      name: 'No internal ID leak',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });
    try {
      repository.createPolicyVersion(contextOne, {
        id: 'policy-no-id-leak-v1',
        policyId: policy.id,
        version: 1,
        rules: {
          ...policyRules(contextOne.storeId),
          allowedAdEntityIds: [`${contextTwo.storeId}-keyword-secret`],
        },
        actorId: 'operator-one',
      });
      throw new Error('Expected attribution failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(MissionDomainRepositoryError);
      const message = (error as Error).message;
      expect(message).toContain('请重新核验当前店铺广告对象');
      expect(message).not.toContain(contextOne.storeId);
      expect(message).not.toContain(contextTwo.storeId);
      expect(message).not.toContain('keyword-secret');
    }
  });

  it('requires product scope to match the authority exact evidence row, not any historical metric with the same names', () => {
    const { database, repository, contextOne } = createHarness();
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne);
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-product-exact-evidence',
      name: 'Exact product evidence only',
      scope: 'product:B0WRONGROW',
      priority: 5,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-product-exact-evidence-v1-invalid',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');

    const exactMetric = database.prepare(`
      INSERT INTO ad_daily_metrics (
        batch_id, report_type, date, store_name, marketplace_code, asin,
        campaign_name, ad_group_name, targeting, source_file, source_row,
        store_id, store_authority_quarantined
      ) VALUES (?, 'keyword', '2026-07-21', 'US Store One', 'US', 'B0WRONGROW',
        'Exact Campaign', 'Exact Ad Group', 'exact keyword', ?, ?, ?, 0)
    `).run(`batch-${contextOne.storeId}`, authority.exactFile, authority.exactRow, contextOne.storeId);
    database.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        candidate_store_ids_json, source_identity_json, status,
        created_at, updated_at
      ) VALUES (999, 'ad_daily_metrics', ?, 'duplicate_identity', '[]', '{}', 'pending', ?, ?)
    `).run(String(exactMetric.lastInsertRowid), NOW, NOW);
    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-product-exact-evidence-v1-quarantined',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    database.prepare(`
      UPDATE store_migration_quarantine
      SET status = 'resolved', resolved_store_id = ?, resolution_note = 'unit proof',
          resolved_at = ?, updated_at = ?
      WHERE migration_version = 999
        AND source_table = 'ad_daily_metrics'
        AND source_row_id = ?
    `).run(contextOne.storeId, NOW, NOW, String(exactMetric.lastInsertRowid));
    const valid = repository.createPolicyVersion(contextOne, {
      id: 'policy-product-exact-evidence-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator-one',
    });
    expect(valid.rules.allowedAdEntityIds).toEqual([authority.entityId]);
  });

  it('fails closed when campaign or ad-group scope has no current canonical identity', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-A-id';
    const adGroupId = 'ad-group-A-id';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      // These deliberately resemble how the old name-based parser interpreted
      // the new multi-part token. Names are not canonical object authority.
      campaignName: adsAccountId,
      adGroupName: campaignId,
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'exact keyword',
      campaignName: adsAccountId,
      adGroupName: campaignId,
    });
    const rules = { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] };
    const campaignPolicy = repository.createPolicy(contextOne, {
      id: 'policy-campaign-without-canonical',
      name: 'Campaign without canonical identity',
      scope: `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`,
      priority: 5,
      actorId: 'operator-one',
    });
    const adGroupPolicy = repository.createPolicy(contextOne, {
      id: 'policy-ad-group-without-canonical',
      name: 'Ad group without canonical identity',
      scope: `ad_group:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}/${encodeURIComponent(adGroupId)}`,
      priority: 6,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-campaign-without-canonical-v1',
      policyId: campaignPolicy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-ad-group-without-canonical-v1',
      policyId: adGroupPolicy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
  });

  it('matches campaign and ad-group scopes by canonical Ads account and object IDs only', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-A/id';
    const adGroupId = 'ad-group-A/id';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      campaignName: 'Visible Campaign Name',
      adGroupName: 'Visible Ad Group Name',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'exact keyword',
      campaignName: 'Visible Campaign Name',
      adGroupName: 'Visible Ad Group Name',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId,
      adGroupId,
    });
    const rules = { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] };
    const createVersion = (id: string, scope: string) => {
      const policy = repository.createPolicy(contextOne, {
        id,
        name: id,
        scope,
        priority: 5,
        actorId: 'operator-one',
      });
      return repository.createPolicyVersion(contextOne, {
        id: `${id}-v1`,
        policyId: policy.id,
        version: 1,
        rules,
        actorId: 'operator-one',
      });
    };
    const rejectVersion = (id: string, scope: string) => {
      const policy = repository.createPolicy(contextOne, {
        id,
        name: id,
        scope,
        priority: 6,
        actorId: 'operator-one',
      });
      expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
        id: `${id}-v1`,
        policyId: policy.id,
        version: 1,
        rules,
        actorId: 'operator-one',
      }), 'REFERENCE_CONFLICT');
    };

    expect(createVersion(
      'policy-canonical-campaign',
      `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`,
    ).rules.allowedAdEntityIds).toEqual([authority.entityId]);
    expect(createVersion(
      'policy-canonical-ad-group',
      `ad_group:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}/${encodeURIComponent(adGroupId)}`,
    ).rules.allowedAdEntityIds).toEqual([authority.entityId]);

    rejectVersion(
      'policy-wrong-ads-account',
      `campaign:${encodeURIComponent('ads-account-other')}/${encodeURIComponent(campaignId)}`,
    );
    rejectVersion(
      'policy-wrong-campaign-id',
      `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent('campaign-B-id')}`,
    );
    rejectVersion(
      'policy-wrong-ad-group-id',
      `ad_group:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}/${encodeURIComponent('ad-group-B-id')}`,
    );
    rejectVersion(
      'policy-legacy-campaign-name',
      `campaign:${encodeURIComponent('Visible Campaign Name')}`,
    );
    rejectVersion(
      'policy-legacy-ad-group-names',
      `ad_group:${encodeURIComponent('Visible Campaign Name')}/${encodeURIComponent('Visible Ad Group Name')}`,
    );
  });

  it('does not let another store canonical identity authorize this store scope', () => {
    const { database, repository, contextOne, contextTwo } = createHarness();
    const otherAccountId = `ads-account-${contextTwo.storeId}`;
    const otherCampaignId = 'campaign-other-store';
    const localAuthority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      campaignName: otherAccountId,
      adGroupName: otherCampaignId,
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: localAuthority.exactFile,
      sourceRow: localAuthority.sourceRow,
      entityName: 'exact keyword',
      campaignName: otherAccountId,
      adGroupName: otherCampaignId,
    });
    const otherAuthority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextTwo, {
      entityId: localAuthority.entityId,
      campaignName: otherAccountId,
      adGroupName: otherCampaignId,
    });
    seedExactPolicyAuthorityMetric(database, contextTwo, {
      sourceFile: otherAuthority.exactFile,
      sourceRow: otherAuthority.sourceRow,
      entityName: 'exact keyword',
      campaignName: otherAccountId,
      adGroupName: otherCampaignId,
    });
    seedCanonicalPolicyIdentity(database, contextTwo, otherAuthority, {
      adsAccountId: otherAccountId,
      campaignId: otherCampaignId,
      adGroupId: 'ad-group-other-store',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-cross-store-canonical',
      name: 'Cross-store canonical identity must not authorize',
      scope: `campaign:${encodeURIComponent(otherAccountId)}/${encodeURIComponent(otherCampaignId)}`,
      priority: 5,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-cross-store-canonical-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [localAuthority.entityId] },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
  });

  it('does not let keyword B enter keyword A canonical campaign scope', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const authorityA = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne);
    const authorityB = seedAdditionalPolicyScopeAuthority(database, contextOne, authorityA, {
      entityId: `${contextOne.storeId}-keyword-B-scope`,
      entityName: 'keyword B',
      campaignName: adsAccountId,
      adGroupName: 'campaign-A-id',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authorityA.exactFile,
      sourceRow: authorityA.sourceRow,
      entityName: 'exact keyword',
      campaignName: 'Exact Campaign',
      adGroupName: 'Exact Ad Group',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authorityA.exactFile,
      sourceRow: authorityA.sourceRow,
      entityName: 'keyword B',
      campaignName: adsAccountId,
      adGroupName: 'campaign-A-id',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authorityA, {
      campaignId: 'campaign-A-id',
      adGroupId: 'ad-group-A-id',
      canonicalKeywordId: 'canonical-keyword-A',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authorityB, {
      campaignId: 'campaign-B-id',
      adGroupId: 'ad-group-B-id',
      canonicalKeywordId: 'canonical-keyword-B',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-A-campaign',
      name: 'Keyword A campaign only',
      scope: `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent('campaign-A-id')}`,
      priority: 5,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-B-in-A-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authorityB.entityId] },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
  });

  it('revalidates the current canonical object revision on draft update and enable', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-A-id';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      campaignName: adsAccountId,
      adGroupName: campaignId,
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'exact keyword',
      campaignName: adsAccountId,
      adGroupName: campaignId,
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId,
      adGroupId: 'ad-group-A-id',
      canonicalKeywordId: 'canonical-current-revision',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-current-canonical-revision',
      name: 'Current canonical revision only',
      scope: `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`,
      priority: 5,
      actorId: 'operator-one',
    });
    const rules = { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] };
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-current-canonical-revision-v1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId: 'campaign-B-id',
      adGroupId: 'ad-group-B-id',
      canonicalKeywordId: 'canonical-current-revision',
      objectRevision: 2,
    });

    expectRepositoryError(() => repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...rules, cooldownMinutes: 30 },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

  it('rejects canonical scope authority resolved in an older Ads session generation on every boundary', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-session-bound';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      campaignName: 'Session-bound Campaign',
      adGroupName: 'Session-bound Ad Group',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'exact keyword',
      campaignName: 'Session-bound Campaign',
      adGroupName: 'Session-bound Ad Group',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId,
      adGroupId: 'ad-group-session-bound',
      canonicalKeywordId: 'canonical-session-bound',
    });
    const scope = `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`;
    const rules = { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] };
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-canonical-session-bound',
      name: 'Canonical session bound',
      scope,
      priority: 5,
      actorId: 'operator-one',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-canonical-session-bound-v1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    });
    const nextContext = normalizeStoreContextEnvelope({ ...contextOne, sessionGeneration: 5 });
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, '5', ?)
      ON CONFLICT(key) DO UPDATE SET value = '5', updated_at = excluded.updated_at
    `).run(`store_session_generation:${contextOne.storeId}`, NOW);

    const createPolicy = repository.createPolicy(nextContext, {
      id: 'policy-old-canonical-session-create',
      name: 'Old canonical session create',
      scope,
      priority: 6,
      actorId: 'operator-one',
    });
    expectRepositoryError(() => repository.createPolicyVersion(nextContext, {
      id: 'policy-old-canonical-session-create-v1',
      policyId: createPolicy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.updateDraftPolicyVersion(nextContext, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...rules, cooldownMinutes: 30 },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.enablePolicyVersion(nextContext, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(nextContext, draft.id)?.status).toBe('draft');
  });

  it('revalidates exact current evidence for store scope on create, update and enable', () => {
    const { database, repository, contextOne } = createHarness();
    const rules = policyRules(contextOne.storeId);
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-store-exact-evidence',
      name: 'Store exact evidence',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-store-exact-evidence-v1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    });
    database.prepare(`
      UPDATE ad_daily_metrics
      SET source_file = 'C:/reports/path-drift/keyword.xlsx'
      WHERE store_id = ? AND source_file = ?
    `).run(contextOne.storeId, `C:/reports/${contextOne.storeId}/baseline/keyword.xlsx`);

    const createPolicy = repository.createPolicy(contextOne, {
      id: 'policy-store-path-drift-create',
      name: 'Store path drift create',
      scope: 'store',
      priority: 6,
      actorId: 'operator-one',
    });
    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-store-path-drift-create-v1',
      policyId: createPolicy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...rules, cooldownMinutes: 30 },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

  it('rejects store scope when the current import snapshot is not bound to a report file', () => {
    const { database, repository, contextOne } = createHarness();
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      lineageKey: 'unbound',
      bindReportFile: false,
      entityName: 'unbound keyword',
      campaignName: 'Unbound Campaign',
      adGroupName: 'Unbound Ad Group',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'unbound keyword',
      campaignName: 'Unbound Campaign',
      adGroupName: 'Unbound Ad Group',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-unbound-report-file',
      name: 'Unbound report file must fail closed',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-unbound-report-file-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
  });

  it('revalidates the latest completed import for keyword scope on create, update and enable', () => {
    const { database, repository, contextOne } = createHarness();
    const entityId = `${contextOne.storeId}-keyword-1`;
    const rules = policyRules(contextOne.storeId);
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-current-import',
      name: 'Keyword current import',
      scope: `keyword:${entityId}`,
      priority: 5,
      actorId: 'operator-one',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-current-import-v1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    });
    const newerRunId = `scope-run-newer-${contextOne.storeId}`;
    const newerAt = '2026-07-22T12:01:00.000Z';
    database.prepare(`
      INSERT INTO report_import_runs (
        store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
        source_file_count, metric_row_count, reconciliation_count,
        started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', 1, 1, 1, ?, ?, ?)
    `).run(
      contextOne.storeId,
      newerRunId,
      `scope-idempotency-newer-${contextOne.storeId}`,
      '7'.repeat(64),
      `batch-${contextOne.storeId}`,
      newerAt,
      newerAt,
      newerAt,
    );
    database.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, snapshot_id, run_id, batch_id, report_type, file_path,
        file_name, file_size_bytes, file_hash, imported_rows, captured_at
      ) VALUES (?, ?, ?, ?, 'keyword', ?, 'keyword-newer.xlsx', 1024, ?, 1, ?)
    `).run(
      contextOne.storeId,
      `scope-snapshot-newer-${contextOne.storeId}`,
      newerRunId,
      `batch-${contextOne.storeId}`,
      `C:/reports/${contextOne.storeId}/newer/keyword.xlsx`,
      '8'.repeat(64),
      newerAt,
    );

    const createPolicy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-stale-create',
      name: 'Keyword stale create',
      scope: `keyword:${entityId}`,
      priority: 6,
      actorId: 'operator-one',
    });
    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-stale-create-v1',
      policyId: createPolicy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...rules, cooldownMinutes: 30 },
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

  it('fails closed for an unknown unstructured policy scope instead of widening it to the store', () => {
    const { repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-unknown-legacy-scope',
      name: 'Unknown legacy scope',
      scope: 'unexpected-legacy-scope',
      priority: 5,
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-unknown-legacy-scope-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator-one',
    }), 'REFERENCE_CONFLICT');
  });

  it('refuses to enable a legacy draft without rate limits and an execution window', () => {
    const { database, repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'legacy-incomplete-policy',
      name: 'Legacy incomplete policy',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'legacy-incomplete-policy-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator-one',
    });
    const incomplete = { ...policyRules(contextOne.storeId) } as Record<string, unknown>;
    delete incomplete.maxDailyActionCount;
    delete incomplete.cooldownMinutes;
    delete incomplete.executionWindow;
    database.prepare('UPDATE policy_versions SET rules_json = ? WHERE store_id = ? AND id = ?')
      .run(JSON.stringify(incomplete), contextOne.storeId, draft.id);
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator-one',
    }), 'INVALID_INPUT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

  it('isolates stores, rejects stale context/CAS, and keeps policy/runtime changes audited', () => {
    const { database, repository, contextOne, contextTwo } = createHarness();
    const { policy, version } = seedEnabledPolicy(repository, contextOne);

    expect(repository.listPolicies(contextOne)).toHaveLength(1);
    expect(repository.listPolicies(contextTwo)).toEqual([]);
    expect(repository.getPolicy(contextTwo, policy.id)).toBeUndefined();
    expectRepositoryError(
      () => repository.listPolicies({ ...contextOne, sessionGeneration: 3 }),
      'STALE_CONTEXT',
    );
    expectRepositoryError(
      () => repository.updatePolicy(contextOne, {
        id: policy.id,
        expectedRevision: 1,
        actorId: 'operator-one',
        patch: { priority: 90 },
      }),
      'REVISION_CONFLICT',
    );
    expectRepositoryError(
      () => repository.updateDraftPolicyVersion(contextOne, {
        id: version.id,
        expectedRevision: version.revision,
        actorId: 'operator-one',
        rules: policyRules(contextOne.storeId),
      }),
      'IMMUTABLE_RECORD',
    );
    expect(() => database.prepare(`
      UPDATE policy_versions SET rules_json = '{}' WHERE id = ?
    `).run(version.id)).toThrow(/immutable/i);

    const runtime = repository.getPolicyRuntime(contextOne);
    const automatic = repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: {
        autonomyMode: 'policy_auto',
        activePolicyVersionId: version.id,
        reason: 'Operator enabled policy automation.',
      },
    });
    expect(automatic).toMatchObject({
      autonomyMode: 'policy_auto',
      killSwitch: false,
      circuitBreakerState: 'closed',
      activePolicyVersionId: version.id,
    });
    expectRepositoryError(
      () => repository.updatePolicyRuntime(contextOne, {
        expectedRevision: runtime.revision,
        actorId: 'operator-one',
        patch: { autonomyMode: 'manual_approval' },
      }),
      'REVISION_CONFLICT',
    );

    const audits = repository.listCausalEvents(contextOne);
    expect(audits.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'policy_created',
      'policy_version_created',
      'policy_version_enabled',
      'policy_runtime_updated',
    ]));
    expect(repository.listCausalEvents(contextTwo)).toEqual([]);
    expect(() => database.prepare(`
      UPDATE causal_events SET title = 'tampered' WHERE id = ?
    `).run(audits[0]!.id)).toThrow(/append-only/i);
    expect(() => database.prepare(`
      DELETE FROM policy_versions WHERE id = ?
    `).run(version.id)).toThrow(/cannot be deleted/i);
  });

  it('allows an empty policy entity allowlist but cannot mint a grant from it', () => {
    const { repository, contextTwo } = createHarness();
    const policy = repository.createPolicy(contextTwo, {
      id: 'policy-no-objects',
      name: 'Policy awaiting stable objects',
      scope: 'sponsored-products-keywords',
      priority: 100,
      actorId: 'operator-one',
    });
    const draftVersion = repository.createPolicyVersion(contextTwo, {
      id: 'policy-version-no-objects',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextTwo.storeId), allowedAdEntityIds: [] },
      actorId: 'operator-one',
    });
    const version = repository.enablePolicyVersion(contextTwo, {
      policyId: policy.id,
      versionId: draftVersion.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftVersion.revision,
      actorId: 'operator-one',
    });
    const draftMission = repository.createMission(contextTwo, {
      id: 'mission-no-objects',
      dataBatchId: `batch-${contextTwo.storeId}`,
      policyVersionId: version.id,
      title: 'Wait for stable advertising objects',
      objective: 'Preserve analysis lineage before entity authority is available.',
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Stable entity authority becomes available'],
      guardrails: ['No advertising mutation before entity selection'],
      actorId: 'operator-one',
    });
    const mission = repository.transitionMission(contextTwo, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      actorId: 'operator-one',
    });
    const decision = createApprovedDecision(repository, contextTwo, mission, version, 1);
    const runtime = repository.getPolicyRuntime(contextTwo);
    repository.updatePolicyRuntime(contextTwo, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });

    expectRepositoryError(
      () => repository.issueMissionGrant(contextTwo, {
        id: 'grant-must-not-exist',
        missionId: mission.id,
        missionRevision: mission.revision,
        decisionIds: [decision.id],
        actionRevision: 1,
        allowedActionTypes: ['set_keyword_bid'],
        allowedAdEntityIds: [`${contextTwo.storeId}-keyword-1`],
        maxChangePct: 5,
        totalImpactBudget: 10,
        expiresAt: '2026-07-23T00:00:00.000Z',
        policyVersionId: version.id,
        policyRevision: version.revision,
        requiredEvidence: policyRules(contextTwo.storeId).requiredEvidence,
        stopConditions: policyRules(contextTwo.storeId).stopConditions,
        issuer: { type: 'policy', actorId: 'policy-engine' },
      }),
      'STATE_CONFLICT',
    );
    expect(repository.listMissionGrants(contextTwo, mission.id)).toEqual([]);
  });
});

describe('MissionDomainRepository mission lineage and grants', () => {
  it('rejects a completed local exact-eight batch without a durable production collection root', () => {
    const { database, repository, contextOne } = createHarness();
    const batchId = 'batch_local_202608280002';
    const runId = 'local-full8-import-run';
    const reportTypes = [
      'campaign',
      'ad_group',
      'placement',
      'advertised_product',
      'auto_targeting',
      'keyword',
      'product_targeting',
      'user_search_term',
    ] as const;
    database.prepare(`
      INSERT INTO lingxing_report_batches (
        id, date_start, date_end, store_name, marketplace_code, status,
        download_dir, created_at, completed_at, store_id, request_id,
        browser_profile_id, business_date, session_generation
      ) VALUES (?, '2026-07-21', '2026-07-21', 'US Store One', 'US', 'completed',
        'logical-download:local-full8', ?, ?, ?, ?, ?, '2026-07-21', 4)
    `).run(batchId, NOW, NOW, contextOne.storeId, `local-import:${batchId}`, contextOne.browserProfileId);
    database.prepare(`
      INSERT INTO report_import_runs (
        store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
        source_file_count, metric_row_count, reconciliation_count,
        started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', 8, 8, 8, ?, ?, ?)
    `).run(
      contextOne.storeId,
      runId,
      `local-full8:${batchId}`,
      'd'.repeat(64),
      batchId,
      NOW,
      NOW,
      NOW,
    );
    for (const [index, reportType] of reportTypes.entries()) {
      const filePath = `C:/reports/local-full8/${reportType}.xlsx`;
      const fileHash = String(index + 1).repeat(64).slice(0, 64);
      const fileId = Number(database.prepare(`
        INSERT INTO report_files (
          store_id, batch_id, report_type, file_path, file_name, file_size,
          status, imported_rows, file_hash, last_imported_at
        ) VALUES (?, ?, ?, ?, ?, 1024, 'imported', 1, ?, ?)
      `).run(
        contextOne.storeId,
        batchId,
        reportType,
        filePath,
        `${reportType}.xlsx`,
        fileHash,
        NOW,
      ).lastInsertRowid);
      database.prepare(`
        INSERT INTO report_import_file_snapshots (
          store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
          file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1024, ?, 1, ?)
      `).run(
        contextOne.storeId,
        `local-full8-snapshot-${reportType}`,
        runId,
        batchId,
        fileId,
        reportType,
        filePath,
        `${reportType}.xlsx`,
        fileHash,
        NOW,
      );
    }
    const { version } = seedEnabledPolicy(repository, contextOne);

    expect(() => repository.createMission(contextOne, {
      id: 'mission-local-full8-without-root',
      dataBatchId: batchId,
      policyVersionId: version.id,
      title: 'Must not trust a local synthetic batch',
      objective: 'Prove formal collection lineage before analysis.',
      priority: 'P1',
      productId: `${contextOne.storeId}-product-1`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Formal collection lineage is present'],
      guardrails: ['Local files never replace production collection'],
      actorId: 'operator-one',
    })).toThrow(
      '运营任务数据批次缺少已成功入库的 production_full 完整 8 类采集根证据；'
      + '请先启动完整 8 类采集并等待入库成功。',
    );
    expect(repository.listMissions(contextOne)).toEqual([]);
  });

  it('accepts an exact-eight batch only after its durable production root import succeeds', () => {
    const { database, repository, contextOne } = createHarness();
    const batchId = 'batch-production-full8-ready';
    const requestId = 'lx:production-full8-ready';
    seedExactEightImportedBatch(database, contextOne, { batchId, requestId });
    seedSucceededProductionFullCollectionRoot(database, contextOne, { batchId, requestId });
    const { version } = seedEnabledPolicy(repository, contextOne);

    const mission = repository.createMission(contextOne, {
      id: 'mission-production-full8-ready',
      dataBatchId: batchId,
      policyVersionId: version.id,
      title: 'Use the durable production collection root',
      objective: 'Analyze only the exact imported production batch.',
      priority: 'P1',
      productId: `${contextOne.storeId}-product-1`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Formal collection lineage remains current'],
      guardrails: ['Reject local or pending substitutes'],
      actorId: 'operator-one',
    });

    expect(mission).toMatchObject({ dataBatchId: batchId, status: 'draft', phase: 'fact' });
  });

  it('rejects unknown Mission patch keys without incrementing the revision', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);

    expectRepositoryError(() => repository.updateMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      actorId: 'operator-one',
      patch: { unsupportedAuthorityField: 'must-not-be-ignored' } as never,
    }), 'INVALID_INPUT');

    expect(repository.getMission(contextOne, mission.id)).toMatchObject({
      revision: mission.revision,
      title: mission.title,
      phase: mission.phase,
    });
  });

  it('freezes the complete Mission definition when the Mission reaches decision', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const decisionPhase = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'active',
      phase: 'decision',
      actorId: 'operator-one',
      reason: 'Analysis is complete and the Mission definition is now evidence-bound.',
    });

    expectRepositoryError(() => repository.updateMission(contextOne, {
      id: decisionPhase.id,
      expectedRevision: decisionPhase.revision,
      actorId: 'operator-one',
      patch: {
        title: 'Must remain immutable',
        objective: 'Must remain immutable',
        priority: 'P0',
        productId: `${contextOne.storeId}-product-2`,
        observationStartsAt: '2026-07-23T00:00:00.000Z',
        observationEndsAt: '2026-07-30T00:00:00.000Z',
        successCriteria: ['Must remain immutable'],
        guardrails: ['Must remain immutable'],
      },
    }), 'STATE_CONFLICT');

    expect(repository.getMission(contextOne, decisionPhase.id)).toEqual(decisionPhase);
  });

  it('allows a title-only rename after decision while preserving every authority field', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const decisionPhase = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'active',
      phase: 'decision',
      actorId: 'operator-one',
    });

    const renamed = repository.updateMission(contextOne, {
      id: decisionPhase.id,
      expectedRevision: decisionPhase.revision,
      actorId: 'operator-one',
      patch: { title: '新的任务显示名称' },
    });

    expect(renamed).toMatchObject({
      title: '新的任务显示名称',
      revision: decisionPhase.revision + 1,
      dataBatchId: decisionPhase.dataBatchId,
      policyVersionId: decisionPhase.policyVersionId,
      productId: decisionPhase.productId,
      objective: decisionPhase.objective,
      observationStartsAt: decisionPhase.observationStartsAt,
      observationEndsAt: decisionPhase.observationEndsAt,
      successCriteria: decisionPhase.successCriteria,
      guardrails: decisionPhase.guardrails,
    });
  });

  it('does not allow a Mission phase to move backward and reopen its frozen definition', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const decisionPhase = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'active',
      phase: 'decision',
      actorId: 'operator-one',
    });

    expectRepositoryError(() => repository.transitionMission(contextOne, {
      id: decisionPhase.id,
      expectedRevision: decisionPhase.revision,
      status: 'active',
      phase: 'analysis',
      actorId: 'operator-one',
      reason: 'Must not reopen the editable definition.',
    }), 'STATE_CONFLICT');
    expect(repository.getMission(contextOne, decisionPhase.id)).toEqual(decisionPhase);
  });

  it('freezes Mission authority fields as soon as a Decision exists even if a legacy phase flag is stale', () => {
    const { repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    createApprovedDecision(repository, contextOne, mission, version, 72);
    expect(mission.phase).toBe('analysis');

    expectRepositoryError(() => repository.updateMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      actorId: 'operator-one',
      patch: { objective: 'Must not rewrite the definition behind an existing Decision.' },
    }), 'STATE_CONFLICT');
    expect(repository.getMission(contextOne, mission.id)).toEqual(mission);
  });

  it('rejects a Decision whose product differs from its Mission product', () => {
    const { repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);

    expectRepositoryError(() => repository.createDecision(contextOne, {
      id: 'decision-product-lineage-mismatch',
      missionId: mission.id,
      dataBatchId: mission.dataBatchId,
      policyVersionId: version.id,
      policyRevision: version.revision,
      actionRevision: 1,
      title: 'Mismatched product decision',
      rationale: 'This proposal must not escape the Mission product scope.',
      recommendation: 'Do not persist this proposal.',
      facts: ['The submitted product differs from the Mission product.'],
      alternatives: ['Regenerate the analysis for the Mission product.'],
      actionType: 'set_keyword_bid',
      adEntityId: `${contextOne.storeId}-keyword-1`,
      productId: `${contextOne.storeId}-product-2`,
      currentValue: 1,
      recommendedValue: 0.95,
      confidence: 0.8,
      status: 'needs_approval',
      actorId: 'ai-analyst',
    }), 'REFERENCE_CONFLICT');

    expect(repository.listDecisions(contextOne, { missionId: mission.id })).toEqual([]);
  });

  it('issues a grant from the lower-number matching policy even when another policy was enabled later', () => {
    const { repository, contextOne } = createHarness();
    const lowPolicy = repository.createPolicy(contextOne, {
      id: 'grant-priority-low-policy',
      name: 'Exact object first-match policy',
      scope: 'store',
      priority: 10,
      actorId: 'operator-one',
    });
    const lowDraft = repository.createPolicyVersion(contextOne, {
      id: 'grant-priority-low-policy-v1',
      policyId: lowPolicy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      validUntil: '2026-08-01T00:00:00.000Z',
      actorId: 'operator-one',
    });
    const lowVersion = repository.enablePolicyVersion(contextOne, {
      policyId: lowPolicy.id,
      versionId: lowDraft.id,
      expectedPolicyRevision: lowPolicy.revision,
      expectedVersionRevision: lowDraft.revision,
      actorId: 'operator-one',
    });
    const laterEnabled = seedEnabledPolicy(repository, contextOne);
    expect(repository.getPolicyRuntime(contextOne).activePolicyVersionId).toBe(laterEnabled.version.id);

    const draftMission = repository.createMission(contextOne, {
      id: 'mission-priority-first-match',
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: lowVersion.id,
      title: 'Use the first matching strategy',
      objective: 'Prove numeric priority instead of last-enabled ordering.',
      productId: `${contextOne.storeId}-product-1`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Lower numeric policy wins'],
      guardrails: ['No last-enabled override'],
      actorId: 'operator-one',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      phase: 'decision',
      actorId: 'operator-one',
    });
    const decision = createApprovedDecision(repository, contextOne, mission, lowVersion, 71);
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: {
        autonomyMode: 'policy_auto',
        activePolicyVersionId: laterEnabled.version.id,
      },
    });

    const grant = repository.issueMissionGrant(contextOne, {
      id: 'grant-priority-first-match',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decision.id],
      actionRevision: decision.actionRevision,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [decision.adEntityId!],
      maxChangePct: 10,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: lowVersion.id,
      policyRevision: lowVersion.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    });

    expect(grant.policyVersionId).toBe(lowVersion.id);
    expect(grant.allowedAdEntityIds).toEqual([decision.adEntityId]);
  });

  it('revalidates Mission authority after a concurrent policy change before the create commit', () => {
    const { database, databasePath, repository, contextOne } = createHarness();
    const { version } = seedEnabledPolicy(repository, contextOne);
    const competing = new Database(databasePath);
    databases.push(competing);
    let retireBeforeCommit = true;
    const raceRepository = new MissionDomainRepository(database, {
      now: () => {
        if (retireBeforeCommit) {
          retireBeforeCommit = false;
          competing.prepare(`
            UPDATE policy_versions
            SET status = 'retired', updated_at = ?
            WHERE store_id = ? AND id = ?
          `).run('2026-07-22T12:00:00.001Z', contextOne.storeId, version.id);
        }
        return new Date(NOW);
      },
      references: {
        productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
        adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
        adEntitySupportsKeywordBid: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
      },
    });
    const missionId = 'mission-concurrent-policy-retirement';

    expectRepositoryError(() => raceRepository.createMission(contextOne, {
      id: missionId,
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: version.id,
      title: 'Reject a stale Mission authority snapshot',
      objective: 'Do not bind a Mission to a policy version retired before commit.',
      priority: 'P1',
      productId: `${contextOne.storeId}-product-1`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['No stale Mission is created'],
      guardrails: ['Policy authority remains active'],
      actorId: 'operator-one',
    }), 'STATE_CONFLICT');

    expect(repository.getMission(contextOne, missionId)).toBeUndefined();
  });

  it('refuses grant issuance when an enabled campaign scope loses current session authority', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-grant-session';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      entityName: 'grant session keyword',
      campaignName: 'Grant Session Campaign',
      adGroupName: 'Grant Session Ad Group',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'grant session keyword',
      campaignName: 'Grant Session Campaign',
      adGroupName: 'Grant Session Ad Group',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId,
      adGroupId: 'ad-group-grant-session',
      canonicalKeywordId: 'canonical-grant-session',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-grant-session-scope',
      name: 'Grant current session scope',
      scope: `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`,
      priority: 5,
      actorId: 'operator-one',
    });
    const draftVersion = repository.createPolicyVersion(contextOne, {
      id: 'policy-grant-session-scope-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator-one',
    });
    const version = repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draftVersion.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftVersion.revision,
      actorId: 'operator-one',
    });
    const draftMission = repository.createMission(contextOne, {
      id: 'mission-grant-session-scope',
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: version.id,
      title: 'Current-session grant authority',
      objective: 'Block grants after canonical identity session drift.',
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['No stale-session grant is issued'],
      guardrails: ['Campaign scope remains bound to the current Ads session'],
      actorId: 'operator-one',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      actorId: 'operator-one',
    });
    const decision = createApprovedDecision(repository, contextOne, mission, version, 21, undefined, 'scope');
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });
    const nextContext = normalizeStoreContextEnvelope({ ...contextOne, sessionGeneration: 5 });
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, '5', ?)
      ON CONFLICT(key) DO UPDATE SET value = '5', updated_at = excluded.updated_at
    `).run(`store_session_generation:${contextOne.storeId}`, NOW);

    expectRepositoryError(() => repository.issueMissionGrant(nextContext, {
      id: 'grant-stale-session-scope',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decision.id],
      actionRevision: decision.actionRevision,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [authority.entityId],
      maxChangePct: 10,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    }), 'REFERENCE_CONFLICT');
    expect(repository.listMissionGrants(nextContext, mission.id)).toEqual([]);
  });

  it('refuses to issue a grant from a legacy enabled policy above the V1 ten-percent boundary', () => {
    const { database, repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'legacy-over-limit-policy',
      name: 'Legacy over-limit policy',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });
    const versionId = 'legacy-over-limit-policy-v1';
    const legacyRules = { ...policyRules(contextOne.storeId), maxChangePct: 20 };
    database.prepare(`
      INSERT INTO policy_versions (
        id, store_id, policy_id, version, status, rules_json, revision,
        created_at, updated_at, enabled_at
      ) VALUES (?, ?, ?, 1, 'enabled', ?, 1, ?, ?, ?)
    `).run(versionId, contextOne.storeId, policy.id, JSON.stringify(legacyRules), NOW, NOW, NOW);
    database.prepare(`
      UPDATE policies
      SET status = 'active', active_version_id = ?, revision = revision + 1, updated_at = ?
      WHERE store_id = ? AND id = ?
    `).run(versionId, NOW, contextOne.storeId, policy.id);
    const version = repository.getPolicyVersion(contextOne, versionId)!;
    const draftMission = repository.createMission(contextOne, {
      id: 'mission-legacy-over-limit',
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: version.id,
      title: 'Legacy policy grant check',
      objective: 'Do not authorize an over-limit historical policy.',
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['No over-limit grant is issued'],
      guardrails: ['V1 change remains at or below ten percent'],
      actorId: 'operator-one',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      actorId: 'operator-one',
    });
    const decision = createApprovedDecision(repository, contextOne, mission, version, 20);
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });

    expectRepositoryError(() => repository.issueMissionGrant(contextOne, {
      id: 'grant-legacy-over-limit',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decision.id],
      actionRevision: decision.actionRevision,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [decision.adEntityId!],
      maxChangePct: 15,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    }), 'INVALID_INPUT');
    expect(repository.listMissionGrants(contextOne, mission.id)).toEqual([]);
  });

  it('holds an IMMEDIATE write lock while re-reading grant authority', () => {
    const { database, databasePath, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const decision = createApprovedDecision(repository, contextOne, mission, version, 9);
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });

    const competing = new Database(databasePath);
    databases.push(competing);
    competing.pragma('busy_timeout = 0');
    let probePending = true;
    let lockProbeRan = false;
    const lockedRepository = new MissionDomainRepository(database, {
      now: () => {
        if (probePending) {
          probePending = false;
          lockProbeRan = true;
          expect(() => competing.prepare(`
            UPDATE missions SET status = 'paused', revision = revision + 1
            WHERE store_id = ? AND id = ?
          `).run(contextOne.storeId, mission.id)).toThrow(/locked/i);
        }
        return new Date(NOW);
      },
      references: {
        productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
        adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
        adEntitySupportsKeywordBid: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
      },
    });

    const grant = lockedRepository.issueMissionGrant(contextOne, {
      id: 'grant-race-proof',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decision.id],
      actionRevision: decision.actionRevision,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [decision.adEntityId!],
      maxChangePct: 10,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    });

    expect(lockProbeRan).toBe(true);
    expect(grant.missionRevision).toBe(mission.revision);
    expect(repository.getMission(contextOne, mission.id)?.status).toBe('active');
  });

  it('binds Mission lineage and applies policy-auto and human grant rules fail closed', () => {
    const { database, repository, contextOne, contextTwo } = createHarness();
    const { policy, version, mission } = seedActiveMission(repository, contextOne);
    const decisionOne = createApprovedDecision(repository, contextOne, mission, version, 1);

    expect(repository.listMissions(contextTwo)).toEqual([]);
    expect(repository.getMission(contextTwo, mission.id)).toBeUndefined();
    expectRepositoryError(
      () => repository.updateMission(contextOne, {
        id: mission.id,
        expectedRevision: mission.revision,
        actorId: 'operator-one',
        patch: { productId: `${contextTwo.storeId}-product-1` },
      }),
      'STATE_CONFLICT',
    );
    const checkpoint = repository.appendMissionCheckpoint(contextOne, {
      id: 'checkpoint-one',
      missionId: mission.id,
      stage: 'ANALYSIS',
      title: 'Diagnosis reviewed',
      status: 'complete',
      evidenceCount: 2,
      actorId: 'operator-one',
    });
    const lineage = repository.getMissionLineage(contextOne, mission.id);
    expect(lineage.links.map((link) => link.linkType)).toEqual(expect.arrayContaining([
      'data_batch',
      'policy_version',
    ]));
    expect(lineage.checkpoints).toEqual([checkpoint]);
    expect(() => database.prepare(`
      DELETE FROM mission_checkpoints WHERE id = ?
    `).run(checkpoint.id)).toThrow(/append-only/i);

    const grantInput = {
      id: 'grant-policy-one',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decisionOne.id],
      actionRevision: 1,
      allowedActionTypes: ['set_keyword_bid'] as const,
      allowedAdEntityIds: [`${contextOne.storeId}-keyword-1`],
      maxChangePct: 10,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy' as const, actorId: 'policy-engine' },
    };
    const initialRuntime = repository.getPolicyRuntime(contextOne);
    const inactiveRuntime = repository.updatePolicyRuntime(contextOne, {
      expectedRevision: initialRuntime.revision,
      actorId: 'operator-one',
      patch: { activePolicyVersionId: null },
    });
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-human-inactive-policy',
        issuer: { type: 'human', actorId: 'operator-one' },
      }),
      'STATE_CONFLICT',
    );
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: inactiveRuntime.revision,
      actorId: 'operator-one',
      patch: { activePolicyVersionId: version.id },
    });
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, grantInput),
      'STATE_CONFLICT',
    );
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });
    const policyGrant = repository.issueMissionGrant(contextOne, grantInput);
    expect(policyGrant).toMatchObject({
      storeId: contextOne.storeId,
      marketplace: 'US',
      currency: 'USD',
      createdSessionGeneration: contextOne.sessionGeneration,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    });
    expect(() => database.prepare(`
      UPDATE mission_grants SET max_change_pct = 20 WHERE id = ?
    `).run(policyGrant.id)).toThrow(/append-only/i);
    const revoked = repository.appendMissionGrantEvent(contextOne, {
      id: 'grant-event-policy-one-revoked',
      grantId: policyGrant.id,
      eventType: 'revoked',
      actorId: 'operator-one',
      reason: 'Operator stopped the remaining batch.',
    });
    expect(repository.getMissionGrantTerminalEvent(contextOne, policyGrant.id)).toEqual(revoked);
    expect(repository.listMissionGrantEvents(contextOne, mission.id)).toEqual([
      revoked,
      expect.objectContaining({
        grantId: policyGrant.id,
        eventType: 'issued',
      }),
    ]);
    expectRepositoryError(
      () => repository.getMissionGrantTerminalEvent(contextTwo, policyGrant.id),
      'NOT_FOUND',
    );
    expectRepositoryError(
      () => repository.listMissionGrantEvents(contextTwo, mission.id),
      'NOT_FOUND',
    );

    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-without-decision',
        decisionIds: [decisionOne.id],
        actionRevision: 3,
      }),
      'REFERENCE_CONFLICT',
    );
    expect(repository.listMissionGrants(contextOne, mission.id)).toHaveLength(1);

    const decisionFour = createApprovedDecision(
      repository,
      contextOne,
      mission,
      version,
      4,
      '2026-07-22T13:00:00.000Z',
    );
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-outlives-decision',
        decisionIds: [decisionFour.id],
        actionRevision: 4,
        expiresAt: '2026-07-22T14:00:00.000Z',
      }),
      'STATE_CONFLICT',
    );

    const decisionTwo = createApprovedDecision(repository, contextOne, mission, version, 2);

    const draftV2 = repository.createPolicyVersion(contextOne, {
      id: 'policy-version-store-one-2',
      policyId: policy.id,
      version: 2,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator-one',
    });
    repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draftV2.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftV2.revision,
      actorId: 'operator-one',
    });
    const retiredAttempt = {
      ...grantInput,
      id: 'grant-retired-policy',
      decisionIds: [decisionTwo.id],
      actionRevision: 2,
    };
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, retiredAttempt),
      'STATE_CONFLICT',
    );
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...retiredAttempt,
        id: 'grant-human-retired-snapshot',
        issuer: { type: 'human', actorId: 'operator-one' },
      }),
      'STATE_CONFLICT',
    );
    expect(repository.getMissionLineage(contextOne, mission.id).grants).toHaveLength(1);

    const decisionFive = createApprovedDecision(repository, contextOne, mission, version, 5);
    const pausedMission = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'paused',
      actorId: 'operator-one',
      reason: 'Operator paused further execution.',
    });
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-while-paused',
        missionRevision: pausedMission.revision,
        decisionIds: [decisionFive.id],
        actionRevision: 5,
        issuer: { type: 'human', actorId: 'operator-one' },
      }),
      'STATE_CONFLICT',
    );
  });

  it('issues one immutable grant for an exact batch of approved decisions', () => {
    const { database, repository, contextOne } = createHarness();
    const rules = {
      ...policyRules(contextOne.storeId),
      allowedAdEntityIds: [
        `${contextOne.storeId}-keyword-1`,
        `${contextOne.storeId}-keyword-2`,
      ],
    };
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-store-one-batch',
      name: 'Two-keyword batch policy',
      scope: 'sponsored-products-keywords',
      priority: 100,
      actorId: 'operator-one',
    });
    const draftVersion = repository.createPolicyVersion(contextOne, {
      id: 'policy-version-store-one-batch-1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    });
    const version = repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draftVersion.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftVersion.revision,
      actorId: 'operator-one',
    });
    const draftMission = repository.createMission(contextOne, {
      id: 'mission-store-one-batch',
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: version.id,
      title: 'Authorize one bounded keyword batch',
      objective: 'Approve once and execute the exact keyword set serially.',
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Both keyword changes retain verified readback evidence'],
      guardrails: ['UNKNOWN stops the remaining batch'],
      actorId: 'operator-one',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      phase: 'analysis',
      actorId: 'operator-one',
    });
    const first = createApprovedDecision(repository, contextOne, mission, version, 6);
    const second = createApprovedDecision(
      repository,
      contextOne,
      mission,
      version,
      6,
      '2026-07-23T00:00:00.000Z',
      '2',
    );
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });

    const batchGrant = repository.issueMissionGrant(contextOne, {
      id: 'grant-store-one-batch-6',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [first.id, second.id],
      actionRevision: 6,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [first.adEntityId!, second.adEntityId!],
      maxChangePct: 10,
      totalImpactBudget: 40,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: rules.requiredEvidence,
      stopConditions: rules.stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    });

    expect(batchGrant.decisionIds).toEqual([first.id, second.id]);
    expect(batchGrant.allowedAdEntityIds).toEqual([first.adEntityId, second.adEntityId]);
    expect(() => database.prepare(`
      UPDATE mission_grants SET decision_ids_json = '[]' WHERE id = ?
    `).run(batchGrant.id)).toThrow(/append-only/i);
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...batchGrant,
        id: 'grant-store-one-batch-duplicate',
        issuer: { type: 'human', actorId: 'operator-one' },
      }),
      'DUPLICATE_IDENTITY',
    );
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...batchGrant,
        id: 'grant-store-one-batch-mismatch',
        decisionIds: [first.id, second.id],
        allowedAdEntityIds: [first.adEntityId!],
        issuer: { type: 'human', actorId: 'operator-one' },
      }),
      'REFERENCE_CONFLICT',
    );
  });
});

describe('MissionDomainRepository decisions, experiments, and causal ledger', () => {
  it('rejects an Experiment when its product differs from the selected Mission product without leaving lineage writes', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-cross-product-mission';
    const before = repository.getMissionLineage(contextOne, mission.id);
    const causalBefore = repository.listCausalEvents(contextOne, { missionId: mission.id });

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject a cross-product experiment',
      hypothesis: 'A product B experiment must not reuse product A Mission evidence.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-2`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'REFERENCE_CONFLICT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
    const after = repository.getMissionLineage(contextOne, mission.id);
    expect(after.experiments).toEqual(before.experiments);
    expect(after.links).toEqual(before.links);
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id }))
      .toEqual(causalBefore);
  });

  it('keeps a draft Experiment unchanged when an edit moves it to another same-store product and matching Ads object', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-cross-product-draft-edit',
      missionId: mission.id,
      name: 'Keep the Mission product boundary',
      hypothesis: 'A draft edit must not reuse product A Mission evidence for product B.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const causalBefore = repository.listCausalEvents(contextOne, { missionId: mission.id });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      actorId: 'operator-one',
      patch: {
        productId: `${contextOne.storeId}-product-2`,
        adEntityId: `${contextOne.storeId}-keyword-2`,
      },
    }), 'REFERENCE_CONFLICT');

    expect(repository.getExperiment(contextOne, draft.id)).toEqual(draft);
    expect(repository.getExperiment(contextOne, draft.id)?.revision).toBe(draft.revision);
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id }))
      .toEqual(causalBefore);
  });

  it('revalidates Experiment lineage after a concurrent Mission archive before the create commit', () => {
    const { database, databasePath, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const competing = new Database(databasePath);
    databases.push(competing);
    let archiveBeforeCommit = true;
    const raceRepository = new MissionDomainRepository(database, {
      now: () => {
        if (archiveBeforeCommit) {
          archiveBeforeCommit = false;
          competing.prepare(`
            UPDATE missions
            SET status = 'archived', archived_at = ?, revision = revision + 1, updated_at = ?
            WHERE store_id = ? AND id = ?
          `).run(
            '2026-07-22T12:00:00.001Z',
            '2026-07-22T12:00:00.001Z',
            contextOne.storeId,
            mission.id,
          );
        }
        return new Date(NOW);
      },
      references: {
        productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
        adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
        adEntitySupportsKeywordBid: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
      },
    });
    const experimentId = 'experiment-concurrent-mission-archive';

    expectRepositoryError(() => raceRepository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject stale Experiment lineage',
      hypothesis: 'An archived Mission cannot receive a new Experiment.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
  });

  it('returns only same-product proven non-UNKNOWN causal memory for Main analysis', () => {
    const { repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const otherProductMission = repository.createMission(contextOne, {
      id: 'mission-other-product-memory',
      dataBatchId: mission.dataBatchId,
      policyVersionId: version.id,
      title: 'Other product memory source',
      objective: 'Prove product-scoped memory isolation.',
      productId: `${contextOne.storeId}-product-2`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Keep products isolated'],
      guardrails: ['Never mix causal memory'],
      actorId: 'operator-one',
    });
    const appendEffect = (input: {
      id: string;
      missionId: string;
      status?: string;
      observedEffect?: string;
      correctsEventId?: string;
    }) => repository.appendCausalEvent(contextOne, {
      id: input.id,
      stage: 'EFFECT',
      eventType: input.correctsEventId ? 'experiment_effect_correction' : 'experiment_effect',
      entityType: 'experiment',
      entityId: input.correctsEventId ?? input.id,
      missionId: input.missionId,
      title: `Causal memory ${input.id}`,
      observedEffect: input.observedEffect ?? 'ACOS improved with stable orders.',
      status: input.status ?? 'verified',
      source: 'experiment-evaluator',
      actorId: 'experiment-evaluator',
      ...(input.correctsEventId ? { correctsEventId: input.correctsEventId } : {}),
    });
    const addProof = (eventId: string, ordinal: number) => repository.appendEvidenceRef(contextOne, {
      id: `memory-proof-${ordinal}`,
      eventId,
      evidenceType: 'experiment_result',
      evidenceRef: `artifact:experiment-result:${ordinal}`,
      sha256: ordinal.toString(16).repeat(64),
    });

    const valid = appendEffect({ id: 'memory-valid', missionId: mission.id });
    addProof(valid.id, 1);
    const unknown = appendEffect({ id: 'memory-unknown', missionId: mission.id, status: 'still_unknown' });
    addProof(unknown.id, 2);
    appendEffect({ id: 'memory-without-proof', missionId: mission.id });
    const otherProduct = appendEffect({ id: 'memory-other-product', missionId: otherProductMission.id });
    addProof(otherProduct.id, 3);
    const corrected = appendEffect({ id: 'memory-corrected', missionId: mission.id });
    addProof(corrected.id, 4);
    appendEffect({
      id: 'memory-correction',
      missionId: mission.id,
      observedEffect: 'Corrected measurement supersedes the old effect.',
      correctsEventId: corrected.id,
    });
    const reconciledUnknown = repository.appendCausalEvent(contextOne, {
      id: 'memory-unknown-reconciled-target',
      stage: 'READBACK',
      eventType: 'execution_unknown_reconciled',
      entityType: 'ad_execution_batch',
      entityId: 'unknown-execution-batch',
      missionId: mission.id,
      title: 'Unknown execution reconciliation',
      observedEffect: 'Two read-only observations found the target bid, but the original batch remains UNKNOWN.',
      status: 'confirmed_target',
      source: 'execution-authority',
      actorId: 'operator-one',
    });
    repository.appendEvidenceRef(contextOne, {
      id: 'memory-unknown-reconciled-proof-first',
      eventId: reconciledUnknown.id,
      evidenceType: 'ad_execution_reconciliation_first',
      evidenceRef: 'artifact:execution-reconciliation:first',
      sha256: '5'.repeat(64),
    });
    repository.appendEvidenceRef(contextOne, {
      id: 'memory-unknown-reconciled-proof-reload',
      eventId: reconciledUnknown.id,
      evidenceType: 'ad_execution_reconciliation_reload',
      evidenceRef: 'artifact:execution-reconciliation:reload',
      sha256: '6'.repeat(64),
    });

    const first = repository.listAnalysisCausalMemory(contextOne, {
      productId: mission.productId!,
      limit: 40,
    });
    const second = repository.listAnalysisCausalMemory(contextOne, {
      productId: mission.productId!,
      limit: 40,
    });

    expect(first).toEqual(second);
    expect(first).toEqual([expect.objectContaining({
      eventId: valid.id,
      missionId: mission.id,
      stage: 'EFFECT',
      observedEffect: 'ACOS improved with stable orders.',
      proofs: [expect.objectContaining({
        evidenceType: 'experiment_result',
        evidenceRef: 'artifact:experiment-result:1',
        sha256: '1'.repeat(64),
      })],
    })]);
    expect(repository.listAnalysisCausalMemory(contextOne, { productId: '', limit: 40 }))
      .toEqual([]);
  });

  it('rolls back a causal event when its complete evidence set cannot be appended atomically', () => {
    const { repository, database, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const eventId = 'causal-atomic-readback-event';

    expectRepositoryError(() => repository.appendCausalEventWithEvidence(contextOne, {
      id: eventId,
      stage: 'READBACK',
      eventType: 'execution_unknown_reconciled',
      entityType: 'ad_execution_batch',
      entityId: 'unknown-batch-atomic',
      missionId: mission.id,
      title: 'Atomic reconciliation evidence',
      observedEffect: 'Two read-only observations were attempted.',
      status: 'confirmed_target',
      source: 'execution-authority',
      actorId: 'operator-one',
    }, [{
      id: 'duplicate-atomic-evidence-id',
      eventId,
      evidenceType: 'ad_execution_reconciliation_first',
      evidenceRef: 'artifact:execution-reconciliation:atomic-first',
      sha256: '7'.repeat(64),
    }, {
      id: 'duplicate-atomic-evidence-id',
      eventId,
      evidenceType: 'ad_execution_reconciliation_reload',
      evidenceRef: 'artifact:execution-reconciliation:atomic-reload',
      sha256: '8'.repeat(64),
    }]), 'DUPLICATE_IDENTITY');

    expect(repository.listCausalEvents(contextOne, { missionId: mission.id })
      .some((event) => event.id === eventId)).toBe(false);
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM evidence_refs
      WHERE store_id = ? AND event_id = ?
    `).get(contextOne.storeId, eventId)).toEqual({ count: 0 });
  });

  it('keeps an Experiment in draft when the exact Ads object has no verified execution readback', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-without-verified-readback',
      missionId: mission.id,
      name: 'Reject an unverified experiment baseline',
      hypothesis: 'A planned bid change must not be mistaken for an applied intervention.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { bidUsd: 1 },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start without a real intervention.',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, draft.id)).toMatchObject({
      status: 'draft',
      revision: draft.revision,
      baseline: { bidUsd: 1 },
    });
  });

  it('does not let archive and restore bypass the verified execution baseline for a draft Experiment', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-restored-without-verified-readback',
      missionId: mission.id,
      name: 'Reject an archive restore baseline bypass',
      hypothesis: 'Archiving a draft must not turn an unverified intervention into a trusted baseline.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { untrustedRendererValue: true, bidUsd: 1 },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const archived = repository.archiveExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      actorId: 'operator-one',
      reason: 'Temporarily hide the draft.',
    });
    const restored = repository.restoreExperiment(contextOne, {
      id: archived.id,
      expectedRevision: archived.revision,
      actorId: 'operator-one',
      reason: 'Restore the same unverified draft.',
    });
    const eventsBeforeStart = repository.listCausalEvents(contextOne, { missionId: mission.id });

    expect(restored).toMatchObject({
      status: 'paused',
      baseline: { untrustedRendererValue: true, bidUsd: 1 },
    });
    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: restored.id,
      expectedRevision: restored.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Attempt to start without verified execution readback.',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, restored.id)).toEqual(restored);
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id })).toEqual(eventsBeforeStart);
    expect(eventsBeforeStart.filter((event) => (
      event.entityId === restored.id && event.eventType === 'experiment_running'
    ))).toHaveLength(0);
  });

  it('rejects an Experiment before persistence when guardrail metrics and criteria are not one-to-one', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-invalid-guardrail-cardinality';

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject an incomplete guardrail contract',
      hypothesis: 'Every guardrail metric must have exactly one machine-readable criterion.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单', 'CVR'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
    expect(repository.getMissionLineage(contextOne, mission.id).experiments)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: experimentId })]));
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ entityId: experimentId })]));
  });

  it('rejects an Experiment before persistence when a guardrail criterion cannot be safely parsed', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-invalid-guardrail-criterion';

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject an ambiguous guardrail criterion',
      hypothesis: 'A machine stop condition must have an explicit comparator and finite threshold.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 ~= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
    expect(repository.getMissionLineage(contextOne, mission.id).experiments)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: experimentId })]));
  });

  it('rejects an Experiment before persistence when a guardrail threshold is negative', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-negative-guardrail-threshold';

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject a negative guardrail threshold',
      hypothesis: 'A result-to-baseline ratio threshold cannot be negative.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= -5%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
  });

  it('rejects an Experiment before persistence when a metric lacks an authoritative data source', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-unsupported-tacos';

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject TACOS without total product sales authority',
      hypothesis: 'Advertising sales must not be substituted for total product sales.',
      primaryMetric: 'TACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
  });

  it('keeps a draft Experiment unchanged when an edit makes its guardrail contract invalid', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-invalid-draft-edit',
      missionId: mission.id,
      name: 'Keep a valid draft contract',
      hypothesis: 'Draft edits must remain machine-evaluable before they are saved.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      patch: { guardrailMetrics: ['广告订单', 'CVR'] },
      actorId: 'operator-one',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, draft.id)).toEqual(draft);
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id })
      .filter((event) => event.entityId === draft.id && event.eventType === 'experiment_updated'))
      .toEqual([]);
  });

  it('keeps a draft Experiment unchanged when an edit adds an ambiguous guardrail criterion', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-invalid-criterion-edit',
      missionId: mission.id,
      name: 'Keep a parseable draft criterion',
      hypothesis: 'Draft stop conditions must remain machine-readable after every edit.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      patch: { guardrailCriteria: ['广告订单 ~= 95%'] },
      actorId: 'operator-one',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, draft.id)).toEqual(draft);
  });

  it('keeps a draft Experiment unchanged when an edit selects a metric without authoritative data', () => {
    const { repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-unsupported-metric-edit',
      missionId: mission.id,
      name: 'Keep an authoritative draft metric',
      hypothesis: 'Editing cannot replace an observable metric with one lacking source authority.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      patch: { primaryMetric: 'TACOS' },
      actorId: 'operator-one',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, draft.id)).toEqual(draft);
  });

  it('keeps an Experiment in draft when verified status has no durable readback evidence checkpoint', () => {
    const { repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(repository, contextOne, mission, version, {
      withEvidenceCheckpoint: false,
    });
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-without-readback-evidence',
      missionId: verified.mission.id,
      name: 'Require durable readback evidence',
      hypothesis: 'A status label without evidence must not become an experiment baseline.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start from a status label without durable evidence.',
    }), 'STATE_CONFLICT');
    expect(repository.getExperiment(contextOne, draft.id)).toMatchObject({
      status: 'draft',
      revision: draft.revision,
    });
  });

  it('starts an Experiment from the exact verified Decision and replaces the renderer baseline', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    database.prepare(`
      UPDATE ad_daily_metrics
      SET asin = ?, clicks = 10, cost = 20, orders = 2, sales = 50,
          acos = 0.4, cvr = 0.2, currency = 'USD'
      WHERE store_id = ? AND batch_id = ? AND targeting = 'baseline keyword 1'
    `).run(mission.productId, contextOne.storeId, mission.dataBatchId);
    const verified = seedVerifiedReadbackDecision(repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-with-verified-readback',
      missionId: verified.mission.id,
      name: 'Bind the verified keyword intervention',
      hypothesis: 'The verified bid reduction improves ACOS without breaching the order guardrail.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { untrustedRendererValue: true, bidUsd: 99 },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start from the verified intervention.',
    });

    expect(running).toMatchObject({
      status: 'running',
      baseline: {
        source: 'verified_ads_readback',
        decisionId: verified.decision.id,
        decisionRevision: verified.decision.revision,
        actionRevision: verified.decision.actionRevision,
        dataBatchId: verified.mission.dataBatchId,
        productId: verified.mission.productId,
        adEntityId: verified.decision.adEntityId,
        currentBidUsd: 1,
        appliedBidUsd: 0.94,
      },
    });
    expect(running.baseline).not.toHaveProperty('untrustedRendererValue');
    expect(repository.listExperimentMetricSnapshots(contextOne, running.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'ACOS',
        value: 0.4,
        dataBatchId: mission.dataBatchId,
      }),
      expect.objectContaining({
        metric: '广告订单',
        value: 2,
        dataBatchId: mission.dataBatchId,
      }),
    ]));
  });

  it('captures the post-window batch and completes an Experiment with a machine-derived result', () => {
    let currentNow = new Date(NOW);
    const { database, repository, contextOne } = createHarness(() => currentNow);
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-machine-evaluation',
      missionId: verified.mission.id,
      name: 'Evaluate the measured keyword intervention',
      hypothesis: 'The verified bid reduction improves ACOS while preserving attributed orders.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start from the verified intervention.',
    });
    const resultBatchId = seedExperimentObservationAuthority(database, contextOne, {
      missionId: verified.mission.id,
      productId: verified.mission.productId!,
      adEntityId: verified.decision.adEntityId!,
      clicks: 10,
      cost: 15,
      orders: 2,
      sales: 50,
    });
    currentNow = new Date('2026-07-30T12:00:00.000Z');

    const completed = repository.evaluateExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      actorId: 'experiment-evaluator',
    });

    expect(completed.status).toBe('completed');
    expect(completed.conclusion).toContain('ACOS：0.4 → 0.3');
    expect(completed.conclusion).toContain('广告订单结果为基线的 100%');
    expect(repository.listExperimentMetricSnapshots(contextOne, running.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'ACOS', value: 0.3, dataBatchId: resultBatchId }),
      expect.objectContaining({ metric: '广告订单', value: 2, dataBatchId: resultBatchId }),
    ]));
    expect(repository.listCausalEvents(contextOne, { missionId: verified.mission.id })
      .filter((event) => event.entityId === running.id && event.eventType === 'experiment_completed'))
      .toHaveLength(1);
    expect(repository.getMission(contextOne, verified.mission.id)).toMatchObject({
      status: 'completed',
      phase: 'effect',
      revision: verified.mission.revision + 1,
    });
    expect(repository.listMissionCheckpoints(contextOne, verified.mission.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'EFFECT',
        title: '经营实验完成效果评估',
        status: 'completed',
        evidenceCount: 2,
        actorId: 'experiment-evaluator',
      }),
    ]));
    expect(repository.listAnalysisCausalMemory(contextOne, {
      productId: verified.mission.productId!,
      limit: 40,
    })).toEqual([expect.objectContaining({
      eventType: 'experiment_completed',
      entityId: running.id,
      observedEffect: completed.conclusion,
      proofs: [expect.objectContaining({
        evidenceType: 'experiment_result_snapshot',
        evidenceRef: expect.stringMatching(/^experiment-result:[a-f0-9]{64}$/),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })],
    })]);
    const archivedExperiment = repository.archiveExperiment(contextOne, {
      id: completed.id,
      expectedRevision: completed.revision,
      actorId: 'operator-one',
      reason: 'Hide the completed experiment from the default queue.',
    });
    const restoredExperiment = repository.restoreExperiment(contextOne, {
      id: archivedExperiment.id,
      expectedRevision: archivedExperiment.revision,
      actorId: 'operator-one',
      reason: 'Show the immutable completed experiment again.',
    });
    expect(restoredExperiment.status).toBe('completed');

    const completedMission = repository.getMission(contextOne, verified.mission.id)!;
    const archivedMission = repository.archiveMission(contextOne, {
      id: completedMission.id,
      expectedRevision: completedMission.revision,
      actorId: 'operator-one',
      reason: 'Hide the completed Mission from the default queue.',
    });
    const restoredMission = repository.restoreMission(contextOne, {
      id: archivedMission.id,
      expectedRevision: archivedMission.revision,
      actorId: 'operator-one',
      reason: 'Show the immutable completed Mission again.',
    });
    expect(restoredMission).toMatchObject({ status: 'completed', phase: 'effect' });
  });

  it('keeps a Mission active and lets the next draft Experiment start after one Experiment completes', () => {
    let currentNow = new Date(NOW);
    const { database, repository, contextOne } = createHarness(() => currentNow);
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(repository, contextOne, mission, version);
    const firstDraft = repository.createExperiment(contextOne, {
      id: 'experiment-first-of-two',
      missionId: verified.mission.id,
      name: 'Evaluate the first measured intervention',
      hypothesis: 'The first verified bid reduction improves ACOS while preserving attributed orders.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const nextDraft = repository.createExperiment(contextOne, {
      id: 'experiment-second-of-two',
      missionId: verified.mission.id,
      name: 'Observe the next measured intervention',
      hypothesis: 'A second bounded observation remains runnable after the first result is recorded.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-31T12:00:00.000Z',
      observationEndsAt: '2026-08-07T12:00:00.000Z',
    });
    const firstRunning = repository.transitionExperiment(contextOne, {
      id: firstDraft.id,
      expectedRevision: firstDraft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start the first verified intervention.',
    });
    seedExperimentObservationAuthority(database, contextOne, {
      missionId: verified.mission.id,
      productId: verified.mission.productId!,
      adEntityId: verified.decision.adEntityId!,
      clicks: 10,
      cost: 15,
      orders: 2,
      sales: 50,
    });
    currentNow = new Date('2026-07-30T12:00:00.000Z');

    const firstCompleted = repository.evaluateExperiment(contextOne, {
      id: firstRunning.id,
      expectedRevision: firstRunning.revision,
      actorId: 'experiment-evaluator',
    });

    expect(firstCompleted.status).toBe('completed');
    expect(repository.getMission(contextOne, verified.mission.id)).toMatchObject({
      status: 'active',
      phase: 'effect',
      revision: verified.mission.revision + 1,
    });

    const nextRunning = repository.transitionExperiment(contextOne, {
      id: nextDraft.id,
      expectedRevision: nextDraft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start the next verified observation after recording the first effect.',
    });

    expect(nextRunning).toMatchObject({
      status: 'running',
      baseline: {
        source: 'verified_ads_readback',
        decisionId: verified.decision.id,
        adEntityId: verified.decision.adEntityId,
      },
    });
    expect(repository.getMission(contextOne, verified.mission.id)).toMatchObject({
      status: 'active',
      phase: 'effect',
    });
  });

  it('pauses an Experiment and records one effect when a measured guardrail is breached', () => {
    let currentNow = new Date(NOW);
    const { database, repository, contextOne } = createHarness(() => currentNow);
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-guardrail-breach',
      missionId: verified.mission.id,
      name: 'Stop on attributed-order guardrail',
      hypothesis: 'The verified bid reduction must preserve at least 95 percent of attributed orders.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start from the verified intervention.',
    });
    seedExperimentObservationAuthority(database, contextOne, {
      missionId: verified.mission.id,
      productId: verified.mission.productId!,
      adEntityId: verified.decision.adEntityId!,
      clicks: 10,
      cost: 15,
      orders: 1,
      sales: 50,
    });
    currentNow = new Date('2026-07-30T12:00:00.000Z');

    const paused = repository.evaluateExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      actorId: 'experiment-evaluator',
    });

    expect(paused.status).toBe('paused');
    expect(paused.conclusion).toContain('守护栏触发，实验已停止继续观察');
    expect(paused.conclusion).toContain('广告订单结果为基线的 50%');
    const experimentEffects = repository.listCausalEvents(contextOne, { missionId: verified.mission.id })
      .filter((event) => event.entityId === running.id);
    expect(experimentEffects.filter((event) => event.eventType === 'experiment_guardrail_triggered'))
      .toHaveLength(1);
    expect(experimentEffects.filter((event) => event.eventType === 'experiment_completed'))
      .toHaveLength(0);
    expect(repository.getMission(contextOne, verified.mission.id)).toMatchObject({
      status: 'blocked',
      phase: 'effect',
      revision: verified.mission.revision + 1,
    });
    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: paused.id,
      expectedRevision: paused.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Ignore the measured guardrail and keep running.',
    }), 'STATE_CONFLICT');
    expect(repository.getExperiment(contextOne, paused.id)).toMatchObject({
      status: 'paused',
      revision: paused.revision,
      conclusion: paused.conclusion,
    });
  });

  it('keeps an Experiment running when an operator tries to complete it before the observation window ends', () => {
    const { repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-early-completion',
      missionId: verified.mission.id,
      name: 'Observe one verified keyword intervention',
      hypothesis: 'The bounded keyword bid change improves ACOS without breaching the order guardrail.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { bidUsd: 1 },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start the evidence-bound observation window.',
    });

    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      status: 'completed',
      actorId: 'operator-one',
      reason: 'Looks good to me.',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, running.id)).toMatchObject({
      status: 'running',
      revision: running.revision,
      conclusion: undefined,
    });
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id })
      .filter((event) => event.entityId === running.id && event.eventType === 'experiment_completed'))
      .toEqual([]);
  });

  it('freezes the Experiment causal contract after its first verified start', () => {
    const { repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-frozen-after-start',
      missionId: verified.mission.id,
      name: 'Freeze one verified intervention',
      hypothesis: 'The verified bid reduction improves ACOS without breaching the order guardrail.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start from the verified intervention.',
    });
    const paused = repository.transitionExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      status: 'paused',
      actorId: 'operator-one',
      reason: 'Pause without changing the causal contract.',
    });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: paused.id,
      expectedRevision: paused.revision,
      actorId: 'operator-one',
      patch: { variant: { bidUsd: 0.5, onlyVariable: 'keyword_bid' } },
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, paused.id)).toMatchObject({
      status: 'paused',
      revision: paused.revision,
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
    });
  });

  it('keeps an Experiment running after the window when required metric snapshots are missing', () => {
    let currentNow = new Date(NOW);
    const { repository, contextOne } = createHarness(() => currentNow);
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-missing-evaluation-snapshots',
      missionId: verified.mission.id,
      name: 'Require measured experiment results',
      hypothesis: 'The keyword intervention improves ACOS while preserving attributed orders.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { bidUsd: 1 },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator-one',
      reason: 'Start the evidence-bound observation window.',
    });
    currentNow = new Date('2026-07-30T12:00:00.000Z');

    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      status: 'completed',
      actorId: 'operator-one',
      reason: 'The operator believes the result is positive.',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, running.id)).toMatchObject({
      status: 'running',
      revision: running.revision,
      conclusion: undefined,
    });
  });

  it('retains decision history, experiment observations, evidence, and causal corrections', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const decision = repository.createDecision(contextOne, {
      id: 'decision-one',
      missionId: mission.id,
      dataBatchId: mission.dataBatchId,
      policyVersionId: version.id,
      policyRevision: version.revision,
      actionRevision: 1,
      title: 'Lower one keyword bid',
      rationale: 'Spend rose while attributed sales stayed flat.',
      recommendation: 'Lower keyword bid from 1.00 to 0.92 USD.',
      facts: ['Seven-day spend increased 18%.'],
      alternatives: ['Keep bid unchanged and observe three more days.'],
      expectedEffect: 'Reduce inefficient spend with limited traffic loss.',
      validUntil: '2026-07-23T00:00:00.000Z',
      actionType: 'set_keyword_bid',
      adEntityId: `${contextOne.storeId}-keyword-1`,
      productId: `${contextOne.storeId}-product-1`,
      currentValue: 1,
      recommendedValue: 0.92,
      confidence: 0.82,
      status: 'needs_approval',
      actorId: 'ai-analyst',
    });
    const revised = repository.reviseDecision(contextOne, {
      id: decision.id,
      expectedRevision: decision.revision,
      recommendation: 'Lower keyword bid from 1.00 to 0.94 USD.',
      recommendedValue: 0.94,
      actorId: 'operator-one',
    });
    const approved = repository.resolveDecision(contextOne, {
      id: revised.id,
      expectedRevision: revised.revision,
      status: 'approved',
      actorId: 'operator-one',
      reason: 'Within the configured policy envelope.',
    });
    const executed = repository.resolveDecision(contextOne, {
      id: approved.id,
      expectedRevision: approved.revision,
      status: 'executed',
      actorId: 'executor-one',
      reason: 'Amazon Ads write submitted with verified identity.',
    });
    const verified = repository.resolveDecision(contextOne, {
      id: executed.id,
      expectedRevision: executed.revision,
      status: 'verified',
      actorId: 'executor-one',
      reason: 'Reload readback matched 0.94 USD.',
    });
    expect(verified.status).toBe('verified');
    const readbackMission = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'active',
      phase: 'readback',
      actorId: 'executor-one',
      reason: 'Execution completed with independent reload readback.',
    });
    repository.appendMissionCheckpoint(contextOne, {
      id: `readback-checkpoint-${mission.id}`,
      missionId: mission.id,
      stage: 'READBACK',
      title: '广告执行回读',
      status: 'verified',
      evidenceCount: 3,
      actorId: 'executor-one',
    });
    expect(repository.listDecisionHistory(contextOne, decision.id).map((item) => item.eventType))
      .toEqual(['created', 'revised', 'approved', 'executed', 'verified']);
    expect(() => database.prepare(`
      UPDATE decision_history SET reason = 'tampered' WHERE decision_id = ?
    `).run(decision.id)).toThrow(/append-only/i);

    const experiment = repository.createExperiment(contextOne, {
      id: 'experiment-one',
      missionId: readbackMission.id,
      name: 'Bid reduction observation',
      hypothesis: 'A six-percent bid reduction lowers ACOS without material sales loss.',
      primaryMetric: 'acos',
      guardrailMetrics: ['sales', 'orders'],
      guardrailCriteria: ['sales decline < 5%', 'orders decline < 5%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { bid: 1, acos: 0.41 },
      variant: { bid: 0.94, bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const updated = repository.updateExperiment(contextOne, {
      id: experiment.id,
      expectedRevision: experiment.revision,
      patch: { guardrailCriteria: ['sales decline < 4%', 'orders decline < 5%'] },
      actorId: 'operator-one',
    });
    repository.transitionExperiment(contextOne, {
      id: updated.id,
      expectedRevision: updated.revision,
      status: 'running',
      actorId: 'operator-one',
    });
    const observation = repository.appendExperimentObservation(contextOne, {
      id: 'experiment-observation-one',
      experimentId: experiment.id,
      observationType: 'observation',
      title: 'Day-one observation',
      observation: 'Sales are stable and ACOS is down one point.',
      observedAt: '2026-07-23T12:00:00.000Z',
      actorId: 'ai-analyst',
    });
    expectRepositoryError(
      () => repository.appendExperimentObservation(contextOne, {
        id: 'experiment-observation-invalid-reference',
        experimentId: experiment.id,
        observationType: 'observation',
        title: 'Invalid implicit correction',
        observation: 'A non-correction record cannot rewrite another observation.',
        observedAt: '2026-07-23T12:03:00.000Z',
        actorId: 'operator-one',
        correctsRecordId: observation.id,
      }),
      'INVALID_INPUT',
    );
    const correctedObservation = repository.appendExperimentObservation(contextOne, {
      id: 'experiment-observation-correction',
      experimentId: experiment.id,
      observationType: 'correction',
      title: 'Corrected day-one observation',
      observation: 'Sales are stable and ACOS is down 0.8 points.',
      observedAt: '2026-07-23T12:05:00.000Z',
      actorId: 'operator-one',
      correctsRecordId: observation.id,
    });
    expect(repository.listExperimentObservations(contextOne, experiment.id))
      .toEqual([correctedObservation, observation]);
    const metricSnapshot = repository.appendExperimentMetricSnapshot(contextOne, {
      id: 'metric-snapshot-one',
      experimentId: experiment.id,
      metric: 'acos',
      value: 0.402,
      currency: 'USD',
      observedAt: '2026-07-23T12:00:00.000Z',
      dataBatchId: mission.dataBatchId,
    });
    expect(repository.listExperimentMetricSnapshots(contextOne, experiment.id))
      .toEqual([metricSnapshot]);

    const fact = repository.appendCausalEvent(contextOne, {
      id: 'causal-manual-fact',
      stage: 'FACT',
      eventType: 'operator_fact',
      entityType: 'product',
      entityId: `${contextOne.storeId}-product-1`,
      missionId: mission.id,
      title: 'Prime Day promotion ended',
      signal: 'Promotion no longer affects the comparison window.',
      status: 'recorded',
      source: 'operator-event',
      actorId: 'operator-one',
    });
    const correction = repository.appendCausalEvent(contextOne, {
      id: 'causal-manual-fact-correction',
      stage: 'FACT',
      eventType: 'operator_fact_correction',
      entityType: 'product',
      entityId: `${contextOne.storeId}-product-1`,
      missionId: mission.id,
      title: 'Promotion end date corrected',
      signal: 'Promotion ended one day later than first recorded.',
      status: 'corrected',
      source: 'operator-event',
      actorId: 'operator-one',
      correctsEventId: fact.id,
    });
    const storeFact = repository.appendCausalEvent(contextOne, {
      id: 'causal-store-fact',
      stage: 'FACT',
      eventType: 'store_fact',
      entityType: 'store',
      entityId: contextOne.storeId,
      title: 'Store-level fact without a Mission',
      signal: 'A store-wide promotion was observed.',
      status: 'recorded',
      source: 'operator-event',
      actorId: 'operator-one',
    });
    const storeCorrection = repository.appendCausalEvent(contextOne, {
      id: 'causal-store-fact-correction',
      stage: 'FACT',
      eventType: 'store_fact_correction',
      entityType: 'store',
      entityId: contextOne.storeId,
      title: 'Store-level fact corrected',
      signal: 'The promotion applied one day later.',
      status: 'corrected',
      source: 'operator-event',
      actorId: 'operator-one',
      correctsEventId: storeFact.id,
    });
    expect(storeCorrection.correctsEventId).toBe(storeFact.id);
    expectRepositoryError(
      () => repository.appendCausalEvent(contextOne, {
        id: 'causal-invalid-cross-entity-correction',
        stage: 'FACT',
        eventType: 'operator_fact_correction',
        entityType: 'product',
        entityId: `${contextOne.storeId}-product-2`,
        missionId: mission.id,
        title: 'Invalid cross-entity correction',
        status: 'corrected',
        source: 'operator-event',
        actorId: 'operator-one',
        correctsEventId: fact.id,
      }),
      'REFERENCE_CONFLICT',
    );
    expectRepositoryError(
      () => repository.appendCausalEvent(contextOne, {
        id: 'causal-invalid-cross-stage-correction',
        stage: 'ANALYSIS',
        eventType: 'operator_analysis_correction',
        entityType: 'product',
        entityId: `${contextOne.storeId}-product-1`,
        missionId: mission.id,
        title: 'Invalid cross-stage correction',
        status: 'corrected',
        source: 'operator-event',
        actorId: 'operator-one',
        correctsEventId: fact.id,
      }),
      'REFERENCE_CONFLICT',
    );
    repository.appendEvidenceRef(contextOne, {
      id: 'evidence-one',
      eventId: correction.id,
      evidenceType: 'readback_bundle',
      evidenceRef: 'artifact:readback:sha256:abc123',
    });
    expectRepositoryError(
      () => repository.appendEvidenceRef(contextOne, {
        id: 'evidence-path',
        eventId: correction.id,
        evidenceType: 'screenshot',
        evidenceRef: 'C:\\evidence\\readback.png',
      }),
      'INVALID_INPUT',
    );

    const lineage = repository.getMissionLineage(contextOne, mission.id);
    expect(lineage.decisions).toHaveLength(1);
    expect(lineage.experiments).toHaveLength(1);
    expect(lineage.causalEvents.map((event) => event.stage)).toEqual(expect.arrayContaining([
      'FACT', 'ANALYSIS', 'DECISION', 'ACTION', 'READBACK',
    ]));
    expect(() => database.prepare(`
      DELETE FROM causal_events WHERE id = ?
    `).run(correction.id)).toThrow(/append-only/i);
    expect(() => database.prepare(`
      DELETE FROM missions WHERE id = ?
    `).run(mission.id)).toThrow(/FOREIGN KEY constraint/i);
  });
});
