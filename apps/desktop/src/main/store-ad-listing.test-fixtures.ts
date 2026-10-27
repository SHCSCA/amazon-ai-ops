import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BrowserProfileId,
  LingxingReportType,
  StoreContextEnvelope,
  StoreId,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '@amazon-ai-ops/local-db/src/sqlite/db';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import {
  StoreCoordinator,
  type StoreSessionGenerationAuthority,
} from './store-coordinator';
import {
  StoreScopedAdListingService,
} from './store-scoped-ad-listing-service';

export class MemorySessions implements StoreSessionGenerationAuthority {
  private readonly values = new Map<StoreId, number>();

  current(storeId: StoreId): number {
    return this.values.get(storeId) ?? 0;
  }

  advance(storeId: StoreId): number {
    const next = this.current(storeId) + 1;
    this.values.set(storeId, next);
    return next;
  }

  advanceMany(storeIds: readonly StoreId[]): ReadonlyMap<StoreId, number> {
    return new Map(storeIds.map((storeId) => [storeId, this.advance(storeId)]));
  }

  assertCurrent(context: StoreContextEnvelope): void {
    if (context.sessionGeneration !== this.current(context.storeId)) throw new Error('stale generation');
  }
}

export type Harness = {
  db: Database;
  dir: string;
  coordinator: StoreCoordinator;
  service: StoreScopedAdListingService;
  firstStoreId: StoreId;
  secondStoreId: StoreId;
  switchFirst(): StoreContextEnvelope;
  switchSecond(): StoreContextEnvelope;
};

export const harnesses: Harness[] = [];

export const ALL_REPORT_TYPES: readonly LingxingReportType[] = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
];

afterEach(() => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!;
    if (harness.db.open) harness.db.close();
    fs.rmSync(harness.dir, { recursive: true, force: true });
  }
});

export function createHarness(): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-ad-listing-'));
  const db = initSqlite(path.join(dir, 'ad-listing.db'));
  const coordinator = new StoreCoordinator({
    repository: new StoreRepository(db),
    sessions: new MemorySessions(),
    now: () => new Date('2026-07-22T18:00:00.000Z'),
    createStoreId: (() => {
      let sequence = 0;
      return () => `ad-listing-store-${++sequence}` as StoreId;
    })(),
    createBrowserProfileId: (storeId) => `profile-${storeId}` as BrowserProfileId,
  });
  const first = coordinator.createStore({ displayName: 'Same Display Name' });
  const second = coordinator.createStore({ displayName: 'Same Display Name' });
  const harness: Harness = {
    db,
    dir,
    coordinator,
    service: new StoreScopedAdListingService({ db, storeCoordinator: coordinator }),
    firstStoreId: first.storeId,
    secondStoreId: second.storeId,
    switchFirst: () => coordinator.getActiveStoreContext()?.storeId === first.storeId
      ? coordinator.getActiveStoreContext()! : coordinator.switchStore(first.storeId).context,
    switchSecond: () => coordinator.getActiveStoreContext()?.storeId === second.storeId
      ? coordinator.getActiveStoreContext()! : coordinator.switchStore(second.storeId).context,
  };
  harnesses.push(harness);
  return harness;
}

export function insertAdMetric(
  harness: Harness,
  storeId: StoreId | null,
  input: {
    campaign: string;
    adGroup: string;
    targeting: string;
    searchTerm: string;
    spend: number;
    sales: number;
    sourceRow: number;
    batchId?: string;
    reportType?: LingxingReportType;
    matchType?: string;
    date?: string;
    sourceFile?: string;
  },
) {
  const result = harness.db.prepare(`
    INSERT INTO ad_daily_metrics (
      store_id, batch_id, date, store_name, marketplace_code, currency, asin,
      campaign_name, ad_group_name, targeting, search_term, match_type,
      report_type, impressions, clicks, cost, orders, sales,
      source_file, source_row
    ) VALUES (?, ?, ?, 'Same Display Name', 'US', 'USD', 'B0TEST001',
      ?, ?, ?, ?, ?, ?, 1000, 100, ?, 10, ?, ?, ?)
  `).run(
    storeId,
    input.batchId ?? null,
    input.date ?? '2026-07-21',
    input.campaign,
    input.adGroup,
    input.targeting,
    input.searchTerm,
    input.matchType ?? null,
    input.reportType ?? 'user_search_term',
    input.spend,
    input.sales,
    input.sourceFile
      ?? `${input.batchId ?? 'legacy'}-${input.reportType ?? 'user_search_term'}-${input.sourceRow}.xlsx`,
    input.sourceRow,
  );
  return Number(result.lastInsertRowid);
}

export function testHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function reportFileHash(batchId: string, reportType: LingxingReportType): string {
  return testHash(`${batchId}:${reportType}`);
}

export function insertProductionLineage(
  harness: Harness,
  input: {
    storeId: StoreId;
    batchId: string;
    createdAt: string;
    dateStart?: string;
    dateEnd?: string;
    state?: 'completed' | 'completed_with_errors' | 'failed';
    proofReportTypes?: readonly LingxingReportType[];
    importRunCreatedAt?: string;
  },
): void {
  const dateStart = input.dateStart ?? '2026-07-01';
  const dateEnd = input.dateEnd ?? '2026-07-21';
  const completedAt = new Date(Date.parse(input.createdAt) + 60_000).toISOString();
  const state = input.state ?? 'completed';
  const proofReportTypes = input.proofReportTypes ?? ALL_REPORT_TYPES;
  const activeContext = harness.coordinator.getActiveStoreContext();
  const context = activeContext?.storeId === input.storeId
    ? activeContext : harness.coordinator.switchStore(input.storeId).context;
  harness.db.prepare(`
    INSERT INTO lingxing_report_batches (
      id, request_id, store_id, browser_profile_id, business_date, session_generation,
      date_start, date_end, store_name, marketplace_code, status, download_dir,
      created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Same Display Name', 'US', 'completed', ?, ?, ?)
  `).run(
    input.batchId,
    `request-${input.batchId}`,
    input.storeId,
    context.browserProfileId,
    context.businessDate,
    context.sessionGeneration,
    dateStart,
    dateEnd,
    `C:/reports/${input.batchId}`,
    input.createdAt,
    completedAt,
  );
  const lineage = {
    lineageId: input.batchId,
    rootJobId: input.batchId,
    expectedReportTypes: [...ALL_REPORT_TYPES],
    purpose: 'production_full',
  };
  harness.db.prepare(`
    INSERT INTO lingxing_collection_jobs (
      store_id, job_id, request_id, browser_profile_id, marketplace, currency,
      business_timezone, business_date, session_generation, date_start, date_end,
      mode, report_types_json, state, snapshot_json, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 'US', 'USD', ?, ?, ?, ?, ?, 'create-and-download', ?,
      ?, ?, ?, ?, ?)
  `).run(
    input.storeId,
    input.batchId,
    `request-${input.batchId}`,
    context.browserProfileId,
    context.businessTimezone,
    context.businessDate,
    context.sessionGeneration,
    dateStart,
    dateEnd,
    JSON.stringify(ALL_REPORT_TYPES),
    state,
    JSON.stringify({ lineage }),
    input.createdAt,
    completedAt,
    completedAt,
  );
  const runId = `import-${input.batchId}`;
  harness.db.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, ?)
  `).run(
    input.storeId,
    runId,
    `idempotency-${input.batchId}`,
    `fingerprint-${input.batchId}`,
    input.batchId,
    proofReportTypes.length,
    proofReportTypes.length,
    input.createdAt,
    completedAt,
    input.importRunCreatedAt ?? completedAt,
  );
  for (const [index, reportType] of proofReportTypes.entries()) {
    const filePath = `C:/reports/${input.batchId}/${reportType}.xlsx`;
    const reportFileId = Number(harness.db.prepare(`
      INSERT INTO report_files (
        store_id, batch_id, report_type, file_path, file_name, file_size,
        status, imported_rows, file_hash, last_imported_at
      ) VALUES (?, ?, ?, ?, ?, 1024, 'imported', 1, ?, ?)
    `).run(
      input.storeId,
      input.batchId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      reportFileHash(input.batchId, reportType),
      completedAt,
    ).lastInsertRowid);
    harness.db.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
        file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1024, ?, 1, ?)
    `).run(
      input.storeId,
      `snapshot-${input.batchId}-${index}`,
      runId,
      input.batchId,
      reportFileId,
      reportType,
      filePath,
      `${reportType}.xlsx`,
      reportFileHash(input.batchId, reportType),
      completedAt,
    );
  }
}

export function insertNewerCompletedReportRun(
  harness: Harness,
  input: {
    storeId: StoreId;
    batchId: string;
    reportType: LingxingReportType;
    runId: string;
    createdAt: string;
    completedAt: string;
  },
): void {
  harness.db.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'completed', 1, 1, 0, ?, ?, ?)
  `).run(
    input.storeId,
    input.runId,
    `idempotency-${input.runId}`,
    `fingerprint-${input.runId}`,
    input.batchId,
    input.createdAt,
    input.completedAt,
    input.createdAt,
  );
  const reportFile = harness.db.prepare(`
    SELECT id, file_path, file_name, file_size
    FROM report_files
    WHERE store_id = ? AND batch_id = ? AND report_type = ?
    LIMIT 1
  `).get(input.storeId, input.batchId, input.reportType) as {
    id: number; file_path: string; file_name: string; file_size: number;
  };
  harness.db.prepare(`
    INSERT INTO report_import_file_snapshots (
      store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
      file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    input.storeId,
    `snapshot-${input.runId}-${input.reportType}`,
    input.runId,
    input.batchId,
    reportFile.id,
    input.reportType,
    reportFile.file_path,
    reportFile.file_name,
    reportFile.file_size,
    testHash(`replacement:${input.runId}:${input.reportType}`),
    input.completedAt,
  );
}

export function insertVerifiedAdEntityAuthority(
  harness: Harness,
  input: {
    storeId: StoreId;
    batchId: string;
    authorityId: string;
    adEntityId: string;
    entityRevision: number;
    entityType: 'keyword' | 'auto_targeting' | 'product_targeting';
    entityName: string;
    campaignName: string;
    adGroupName: string;
    sourceRow: number;
    evidenceImportRunId?: string;
    evidenceSessionGeneration?: number;
    sourceFileHash?: string;
  },
): void {
  const scopeKey = `${input.storeId}-${input.batchId}`;
  const policyId = `authority-policy-${scopeKey}`;
  const policyVersionId = `authority-policy-version-${scopeKey}`;
  const missionId = `authority-mission-${scopeKey}`;
  const evidenceId = `authority-evidence-${scopeKey}`;
  const activeContext = harness.coordinator.getActiveStoreContext();
  const context = activeContext?.storeId === input.storeId
    ? activeContext : harness.coordinator.switchStore(input.storeId).context;
  const now = '2026-07-22T12:00:00.000Z';
  harness.db.prepare(`
    INSERT OR IGNORE INTO policies (
      id, store_id, name, scope, status, priority, active_version_id,
      revision, created_at, updated_at
    ) VALUES (?, ?, 'Authority policy', 'store', 'active', 1, NULL, 1, ?, ?)
  `).run(policyId, input.storeId, now, now);
  harness.db.prepare(`
    INSERT OR IGNORE INTO policy_versions (
      id, store_id, policy_id, version, status, rules_json, revision,
      created_at, updated_at, enabled_at
    ) VALUES (?, ?, ?, 1, 'enabled', '{}', 1, ?, ?, ?)
  `).run(policyVersionId, input.storeId, policyId, now, now, now);
  harness.db.prepare(`
    UPDATE policies SET active_version_id = ? WHERE store_id = ? AND id = ?
  `).run(policyVersionId, input.storeId, policyId);
  harness.db.prepare(`
    INSERT OR IGNORE INTO missions (
      id, store_id, marketplace, currency, business_date,
      created_session_generation, data_batch_id, policy_version_id,
      title, objective, status, phase, priority, observation_starts_at,
      observation_ends_at, success_criteria_json, guardrails_json, revision,
      created_at, updated_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, 'Authority mission',
      'Bind current stable Ads entity', 'active', 'decision', 'P1', ?, ?,
      '[]', '[]', 1, ?, ?)
  `).run(
    missionId,
    input.storeId,
    context.businessDate,
    context.sessionGeneration,
    input.batchId,
    policyVersionId,
    now,
    '2026-07-30T12:00:00.000Z',
    now,
    now,
  );
  harness.db.prepare(`
    INSERT OR IGNORE INTO analysis_evidence_packages (
      id, store_id, marketplace, currency, mission_id, data_batch_id,
      import_run_id, date_from, date_to, report_types_json, sources_json,
      metric_row_count, reconciliation_hash, rule_revision, model_revision,
      package_hash, imported_at, fresh_until, sealed_at,
      created_session_generation
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, '2026-07-01', '2026-07-21',
      ?, '[]', 1, ?, ?, 'model-test', ?, ?, '2026-07-30T12:00:00.000Z', ?, ?)
  `).run(
    evidenceId,
    input.storeId,
    missionId,
    input.batchId,
    input.evidenceImportRunId ?? `import-${input.batchId}`,
    JSON.stringify([input.entityType]),
    testHash(`reconciliation:${scopeKey}`),
    testHash(`rules:${scopeKey}`),
    testHash(`package:${scopeKey}`),
    now,
    now,
    input.evidenceSessionGeneration ?? context.sessionGeneration,
  );
  harness.db.prepare(`
    INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type,
      entity_name, campaign_name, ad_group_name, evidence_package_id,
      source_report_type, source_file_hash, source_row, identity_source,
      proof_sha256, verified_by, verified_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ads_ui', ?, 'operator', ?, ?)
  `).run(
    input.authorityId,
    input.storeId,
    input.adEntityId,
    input.entityRevision,
    input.entityType,
    input.entityName,
    input.campaignName,
    input.adGroupName,
    evidenceId,
    input.entityType,
    input.sourceFileHash ?? reportFileHash(input.batchId, input.entityType),
    input.sourceRow,
    testHash(`proof:${input.authorityId}`),
    now,
    now,
  );
}

export function insertKeywordIdentityVersion(
  harness: Harness,
  input: {
    storeId: StoreId;
    identityVersionId: string;
    canonicalKeywordId: string;
    adEntityId: string;
    entityRevision: number;
    adsAccountId: string;
    campaignId: string;
    adGroupId: string;
    keywordId: string;
    objectRevision: number;
    sourceAuthorityId: string;
    resolvedSessionGeneration: number;
    sourceAuthorityProofSha256?: string;
  },
): void {
  harness.db.prepare(`
    INSERT INTO ad_keyword_identity_versions (
      identity_version_id, store_id, marketplace, currency, canonical_keyword_id,
      ad_entity_id, entity_revision, ads_account_id, campaign_id, ad_group_id,
      keyword_id, object_revision, observed_bid_cents, page_identity_hash,
      source_authority_id, source_authority_proof_sha256, resolution_proof_sha256,
      resolved_session_generation, resolved_at, resolved_by, created_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, ?, ?, 125, ?, ?, ?, ?, ?,
      '2026-07-22T12:01:00.000Z', 'operator', '2026-07-22T12:01:00.000Z')
  `).run(
    input.identityVersionId,
    input.storeId,
    input.canonicalKeywordId,
    input.adEntityId,
    input.entityRevision,
    input.adsAccountId,
    input.campaignId,
    input.adGroupId,
    input.keywordId,
    input.objectRevision,
    testHash(`page:${input.identityVersionId}`),
    input.sourceAuthorityId,
    input.sourceAuthorityProofSha256 ?? testHash(`proof:${input.sourceAuthorityId}`),
    testHash(`resolution:${input.identityVersionId}`),
    input.resolvedSessionGeneration,
  );
}

export function insertKeywordMetric(
  harness: Harness,
  storeId: StoreId | null,
  asin: string,
  keyword: string,
  sourceRow: number,
) {
  const result = harness.db.prepare(`
    INSERT INTO keyword_metrics (
      store_id, normalized_keyword, raw_keyword, source, source_type,
      asin, impressions, clicks, cost, orders, sales, source_file, source_row
    ) VALUES (?, ?, ?, 'lingxing', 'search_term', ?, 500, 25, 30, 5, 150, ?, ?)
  `).run(storeId, keyword, keyword, asin, `keyword-${sourceRow}.xlsx`, sourceRow);
  return Number(result.lastInsertRowid);
}

export function quarantineRow(
  harness: Harness,
  sourceTable: 'ad_daily_metrics' | 'keyword_metrics' | 'keyword_opportunities',
  sourceRowId: number,
): void {
  harness.db.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      candidate_store_ids_json, source_identity_json, status,
      created_at, updated_at
    ) VALUES (
      98, ?, ?, 'ambiguous_store_identity', '[]', '{}', 'pending',
      datetime('now'), datetime('now')
    )
  `).run(sourceTable, String(sourceRowId));
}
