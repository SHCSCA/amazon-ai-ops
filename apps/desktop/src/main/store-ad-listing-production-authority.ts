import { type LingxingReportType, type StoreId } from '@amazon-ai-ops/shared-types';
import {
  type ProductionAdAuthority,
  type ProductionLineageJobRow,
  type ProductionLineageJob,
  type ProductionImportProofRow,
} from "./store-ad-listing-contracts";
import {
  parseProductionLineageJob,
  isValidProductionRoot,
  validatedProductionLineageFamily,
  isLingxingReportType,
  hasCompleteReportTypeSet,
} from "./store-ad-listing-lineage-values";
import type { StoreAdListingRuntime } from './store-ad-listing-runtime';

export function resolveProductionAdAuthority(this: StoreAdListingRuntime,
  storeId: StoreId,
  dateFrom: string | undefined,
  dateTo: string | undefined): ProductionAdAuthority | undefined {
    const clauses = [
      'store_id = ?',
      "request_id NOT LIKE 'canary:%'",
      "marketplace = 'US'",
      "currency = 'USD'",
    ];
    const parameters: unknown[] = [storeId];
    if (dateFrom) {
      clauses.push('date_start <= ?', 'date_end >= ?');
      parameters.push(dateFrom, dateFrom);
    }
    if (dateTo) {
      clauses.push('date_start <= ?', 'date_end >= ?');
      parameters.push(dateTo, dateTo);
    }
    const jobs = (this.db.prepare(`
      SELECT job_id, date_start, date_end, report_types_json, snapshot_json, created_at
      FROM lingxing_collection_jobs
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC, job_id DESC
    `).all(...parameters) as ProductionLineageJobRow[])
      .map(parseProductionLineageJob)
      .filter((job): job is ProductionLineageJob => job !== undefined);
    const roots = jobs.filter(isValidProductionRoot);
    if (roots.length === 0) return undefined;

    const proofs = this.db.prepare(`
      SELECT
        runs.batch_id AS batchId,
        snapshots.report_type AS reportType,
        runs.completed_at AS runCompletedAt
      FROM report_import_runs runs
      INNER JOIN report_import_file_snapshots snapshots
        ON snapshots.store_id = runs.store_id
       AND snapshots.run_id = runs.run_id
       AND snapshots.batch_id = runs.batch_id
      INNER JOIN lingxing_report_batches batches
        ON batches.store_id = runs.store_id
       AND batches.id = runs.batch_id
      WHERE runs.store_id = ?
        AND runs.status = 'completed'
        AND batches.status IN ('completed', 'completed_with_errors')
        AND COALESCE(batches.request_id, '') NOT LIKE 'canary:%'
        AND snapshots.report_file_id IS NOT NULL
    `).all(storeId) as ProductionImportProofRow[];

    // Creation order selects the current production root. Never fall back to
    // an older complete lineage while a newer root is partial, running, or
    // failed: stale facts must not silently regain authority.
    const root = roots[0];
    const family = validatedProductionLineageFamily(root, jobs);
    const familyById = new Map(family.map((job) => [job.jobId, job]));
    const familyProofs = proofs
      .filter((proof) => {
        const job = familyById.get(proof.batchId);
        return Boolean(
          job
          && isLingxingReportType(proof.reportType)
          && job.reportTypes.includes(proof.reportType as LingxingReportType),
        );
      })
      .sort((left, right) => {
        const leftJob = familyById.get(left.batchId)!;
        const rightJob = familyById.get(right.batchId)!;
        return rightJob.createdAt.localeCompare(leftJob.createdAt)
          || right.runCompletedAt.localeCompare(left.runCompletedAt)
          || right.batchId.localeCompare(left.batchId);
      });
    const batchByReportType = new Map<LingxingReportType, string>();
    for (const proof of familyProofs) {
      const reportType = proof.reportType as LingxingReportType;
      if (!batchByReportType.has(reportType)) batchByReportType.set(reportType, proof.batchId);
    }
    if (!hasCompleteReportTypeSet(batchByReportType.keys())) return undefined;
    return {
      dateStart: root.dateStart,
      dateEnd: root.dateEnd,
      batchByReportType,
    };
  }
