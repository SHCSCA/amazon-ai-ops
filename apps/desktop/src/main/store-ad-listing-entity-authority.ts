import { type LingxingReportType, type StoreId } from '@amazon-ai-ops/shared-types';
import { type ProductionAdAuthority, type StableAdEntityAuthority, type StableAdEntityAuthorityRow } from "./store-ad-listing-contracts";
import { nonEmptyString } from "./store-ad-listing-input-values";
import { canonicalKeywordIdentityFromRow, stableAdEntityPathKey } from "./store-ad-listing-identity-values";
import type { StoreAdListingRuntime } from './store-ad-listing-runtime';

export function loadCurrentStableAdEntityAuthorities(this: StoreAdListingRuntime,
  storeId: StoreId,
  sessionGeneration: number,
  productionAuthority: ProductionAdAuthority,
  selectedReportBatches: readonly { reportType: LingxingReportType; batchId: string }[]): Map<string, StableAdEntityAuthority[]> {
    const writableReportBatches = selectedReportBatches.filter(
      (item): item is { reportType: 'keyword' | 'auto_targeting' | 'product_targeting'; batchId: string } => (
        item.reportType === 'keyword'
        || item.reportType === 'auto_targeting'
        || item.reportType === 'product_targeting'
      ),
    );
    if (writableReportBatches.length === 0) return new Map();
    const rows = this.db.prepare(`
      SELECT
        metrics.id AS metric_id,
        (SELECT MAX(current_authority.entity_revision)
         FROM verified_ad_entity_authority current_authority
         WHERE current_authority.store_id = authority.store_id
           AND current_authority.ad_entity_id = authority.ad_entity_id) AS current_entity_revision,
        authority.authority_id,
        authority.ad_entity_id,
        authority.entity_revision,
        authority.source_report_type,
        authority.entity_name,
        authority.campaign_name,
        authority.ad_group_name,
        CASE
          WHEN authority.source_report_type = 'keyword'
          THEN NULLIF(lower(trim(metrics.match_type)), '')
          ELSE NULL
        END AS match_type,
        identity.ads_account_id,
        identity.campaign_id,
        identity.ad_group_id,
        identity.keyword_id,
        identity.object_revision
      FROM verified_ad_entity_authority authority
      INNER JOIN analysis_evidence_packages evidence
        ON evidence.store_id = authority.store_id
       AND evidence.id = authority.evidence_package_id
      INNER JOIN report_import_runs import_run
        ON import_run.store_id = evidence.store_id
       AND import_run.run_id = evidence.import_run_id
       AND import_run.batch_id = evidence.data_batch_id
       AND import_run.status = 'completed'
      INNER JOIN report_import_file_snapshots snapshots
        ON snapshots.store_id = evidence.store_id
       AND snapshots.run_id = evidence.import_run_id
       AND snapshots.batch_id = evidence.data_batch_id
       AND snapshots.report_type = authority.source_report_type
       AND snapshots.file_hash = authority.source_file_hash
       AND snapshots.report_file_id IS NOT NULL
      INNER JOIN ad_daily_metrics metrics
        ON metrics.store_id = evidence.store_id
       AND metrics.batch_id = evidence.data_batch_id
       AND metrics.report_type = authority.source_report_type
       AND metrics.source_file = snapshots.file_path
       AND metrics.source_row = authority.source_row
      LEFT JOIN ad_keyword_identity_versions identity
        ON authority.source_report_type = 'keyword'
       AND identity.store_id = authority.store_id
       AND identity.ad_entity_id = authority.ad_entity_id
       AND identity.entity_revision = authority.entity_revision
       AND identity.source_authority_id = authority.authority_id
       AND identity.source_authority_proof_sha256 = authority.proof_sha256
       AND identity.resolved_session_generation = ?
       AND identity.marketplace = 'US'
       AND identity.currency = 'USD'
       AND NOT EXISTS (
         SELECT 1
         FROM ad_keyword_identity_versions newer_identity
         WHERE newer_identity.store_id = identity.store_id
           AND newer_identity.canonical_keyword_id = identity.canonical_keyword_id
           AND newer_identity.object_revision > identity.object_revision
       )
      WHERE authority.store_id = ?
        AND evidence.created_session_generation = ?
        AND authority.entity_type = authority.source_report_type
        AND (${writableReportBatches.map(() => (
          '(authority.source_report_type = ? AND evidence.data_batch_id = ?)'
        )).join(' OR ')})
        AND metrics.date >= ?
        AND metrics.date <= ?
        AND metrics.store_authority_quarantined = 0
        AND lower(trim(COALESCE(metrics.campaign_name, '')))
          = lower(trim(authority.campaign_name))
        AND lower(trim(COALESCE(metrics.ad_group_name, '')))
          = lower(trim(authority.ad_group_name))
        AND lower(trim(COALESCE(metrics.targeting, '')))
          = lower(trim(authority.entity_name))
        AND NOT EXISTS (
          SELECT 1
          FROM store_migration_quarantine quarantine
          WHERE quarantine.source_table = 'ad_daily_metrics'
            AND quarantine.source_row_id = CAST(metrics.id AS TEXT)
            AND quarantine.status = 'pending'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM verified_ad_entity_authority newer
          WHERE newer.store_id = authority.store_id
            AND newer.ad_entity_id = authority.ad_entity_id
            AND newer.entity_revision > authority.entity_revision
            AND newer.source_report_type = authority.source_report_type
            AND newer.source_file_hash = authority.source_file_hash
            AND newer.source_row = authority.source_row
            AND newer.evidence_package_id = authority.evidence_package_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM report_import_runs newer_run
          INNER JOIN report_import_file_snapshots newer_snapshot
            ON newer_snapshot.store_id = newer_run.store_id
           AND newer_snapshot.run_id = newer_run.run_id
           AND newer_snapshot.batch_id = newer_run.batch_id
          WHERE newer_run.store_id = import_run.store_id
            AND newer_run.status = 'completed'
            AND newer_snapshot.report_type = snapshots.report_type
            AND (
              newer_run.completed_at > import_run.completed_at
              OR (
                newer_run.completed_at = import_run.completed_at
                AND newer_run.created_at > import_run.created_at
              )
              OR (
                newer_run.completed_at = import_run.completed_at
                AND newer_run.created_at = import_run.created_at
                AND newer_run.run_id > import_run.run_id
              )
            )
        )
    `).all(
      sessionGeneration,
      storeId,
      sessionGeneration,
      ...writableReportBatches.flatMap(({ reportType, batchId }) => [reportType, batchId]),
      productionAuthority.dateStart,
      productionAuthority.dateEnd,
    ) as StableAdEntityAuthorityRow[];
    const byPath = new Map<string, StableAdEntityAuthority[]>();
    for (const row of rows) {
      const entityId = nonEmptyString(row.ad_entity_id);
      const entityRevision = Number(row.entity_revision);
      const authorityId = nonEmptyString(row.authority_id);
      const metricId = Number(row.metric_id);
      const currentEntityRevision = Number(row.current_entity_revision);
      if (!entityId || !authorityId || !Number.isSafeInteger(entityRevision) || entityRevision < 1
        || !Number.isSafeInteger(metricId) || metricId < 1
        || !Number.isSafeInteger(currentEntityRevision) || currentEntityRevision < 1) continue;
      const canonicalKeywordIdentity = canonicalKeywordIdentityFromRow(row);
      const key = stableAdEntityPathKey(
        row.source_report_type,
        row.campaign_name,
        row.ad_group_name,
        row.entity_name,
        row.match_type,
      );
      const candidates = byPath.get(key) ?? [];
      candidates.push({
        metricId,
        authorityId,
        currentEntityRevision,
        entityId,
        entityRevision,
        ...(canonicalKeywordIdentity ? { canonicalKeywordIdentity } : {}),
      });
      byPath.set(key, candidates);
    }
    return byPath;
  }
