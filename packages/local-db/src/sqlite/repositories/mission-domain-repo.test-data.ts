import Database from 'better-sqlite3';
import { type PolicyVersionRules, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
export const NOW = '2026-07-22T12:00:00.000Z';

export const policyRules = (storeId: string): PolicyVersionRules => ({
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

export function seedExperimentObservationAuthority(
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
    ) VALUES (?, '2026-07-22', '2026-07-29', 'US Store One', 'US', 'completed',
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
    ) VALUES (?, ?, ?, ?, ?, 'completed', 8, 1, 8, ?, ?, ?)
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
  seedOtherExperimentReports(database, context, batchId, runId);
  database.prepare(`
    INSERT INTO analysis_evidence_packages (
      id, store_id, marketplace, currency, mission_id, data_batch_id,
      import_run_id, date_from, date_to, asin, report_types_json, sources_json,
      metric_row_count, reconciliation_hash, rule_revision, model_revision,
      package_hash, imported_at, fresh_until, sealed_at,
      created_session_generation
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, '2026-07-22', '2026-07-29', ?,
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
    ) VALUES (?, 'keyword', '2026-07-29', 'US Store One', 'US', ?,
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

export function seedCanonicalPolicyIdentity(
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

export const EXACT_EIGHT_REPORT_TYPES = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
] as const;

export function seedOtherExperimentReports(database: Database.Database, context: StoreContextEnvelope, batchId: string, runId: string): void {
  for (const type of EXACT_EIGHT_REPORT_TYPES.filter(type => type !== 'keyword')) {
    const filePath = `C:/reports/${batchId}/${type}.xlsx`;
    const fileId = Number(database.prepare(`INSERT INTO report_files(store_id,batch_id,report_type,file_path,file_name,file_size,status,imported_rows,file_hash)
      VALUES(?,?,?,?,?,1024,'imported',0,?)`).run(context.storeId,batchId,type,filePath,`${type}.xlsx`,'a'.repeat(64)).lastInsertRowid);
    database.prepare(`INSERT INTO report_import_file_snapshots(store_id,snapshot_id,run_id,batch_id,report_file_id,report_type,file_path,file_name,file_size_bytes,file_hash,imported_rows,captured_at)
      VALUES(?,?,?,?,?,?,?,?,1024,?,0,?)`).run(context.storeId,`${runId}:${type}`,runId,batchId,fileId,type,filePath,`${type}.xlsx`,'a'.repeat(64),NOW);
  }
  const batch = database.prepare('SELECT request_id FROM lingxing_report_batches WHERE store_id=? AND id=?').get(context.storeId,batchId) as { request_id: string };
  database.prepare(`INSERT INTO report_import_reconciliations(store_id,reconciliation_id,run_id,batch_id,metric_date,report_type,
    expected_rows,actual_rows,expected_cost_1e4,actual_cost_1e4,absolute_cost_delta_1e4,tolerance_1e4,within_tolerance,status,reconciled_at)
    SELECT files.store_id,files.snapshot_id,files.run_id,files.batch_id,batch.date_end,files.report_type,
      files.imported_rows,files.imported_rows,0,0,0,0,1,'matched',?
    FROM report_import_file_snapshots files JOIN lingxing_report_batches batch ON batch.store_id=files.store_id AND batch.id=files.batch_id
    WHERE files.store_id=? AND files.run_id=?`).run(NOW,context.storeId,runId);
  seedSucceededProductionFullCollectionRoot(database, context, { batchId, requestId: batch.request_id });
}

export function seedExactEightImportedBatch(
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

export function seedSucceededProductionFullCollectionRoot(
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
