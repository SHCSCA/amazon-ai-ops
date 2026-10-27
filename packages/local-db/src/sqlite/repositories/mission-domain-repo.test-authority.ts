import Database from 'better-sqlite3';
import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { NOW, seedOtherExperimentReports } from './mission-domain-repo.test-data';
export function seedProductScopeAuthorityWithOnlyUnrelatedMetric(
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
    ) VALUES (?, ?, ?, ?, ?, 'completed', ?, 1, ?, ?, ?, ?)
  `).run(context.storeId, runId, `scope-idempotency-${lineageKey}-${context.storeId}`, 'b'.repeat(64), batchId,
    lineageKey === 'baseline' ? 8 : 1, lineageKey === 'baseline' ? 8 : 1, NOW, NOW, NOW);
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
  if (lineageKey === 'baseline') seedOtherExperimentReports(database, context, batchId, runId);
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

export function seedAdditionalPolicyScopeAuthority(
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

export function seedExactPolicyAuthorityMetric(
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

export function seedDefaultPolicyScopeAuthority(
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
