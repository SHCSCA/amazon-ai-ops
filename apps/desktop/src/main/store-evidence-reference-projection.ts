import path from 'node:path';
import type Database from 'better-sqlite3';
import type { StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { normalizeStoreId } from '@amazon-ai-ops/shared-types';
import type { StoreEvidenceRetentionBlocker } from './store-evidence-retention';

/**
 * Direct DB file references that can point into the Store Capsule retention
 * candidate roots (`screenshots/` and `traces/`).
 *
 * Current-schema path columns intentionally excluded here:
 * - report/download inputs (`source_file`, `file_path`, `download_dir`,
 *   `manifest_path`) live in permanently protected report/download scopes;
 * - DOM snapshots have no retention candidate root;
 * - Execution Authority evidence lives in the permanently protected
 *   `evidence/` scope.
 */
export const STORE_EVIDENCE_RETENTION_REFERENCE_COLUMNS = Object.freeze([
  'action_logs.screenshot_before',
  'action_logs.screenshot_after',
  'action_logs.trace_path',
  'lingxing_report_files.failure_screenshot_path',
  'lingxing_report_files.failure_trace_path',
  'download_center_diagnostics.screenshot_path',
  'operation_events.evidence_path',
  'listing_content.screenshot_path',
  'listing_content_versions.screenshot_path',
] as const);

export interface StoreEvidenceArtifactReference {
  readonly artifactId: string;
  readonly source: 'operation_events.evidence_path';
  /** Store recorded on the DB row that owns this reference. */
  readonly referencedStoreId: string;
  readonly ownership: 'current-store' | 'foreign-store';
}

export interface StoreEvidenceDatabaseReferenceProjection {
  readonly databaseReferencedPaths: readonly string[];
  readonly artifactReferences: readonly StoreEvidenceArtifactReference[];
  readonly blockers: readonly StoreEvidenceRetentionBlocker[];
}

interface ReferenceRow {
  readonly source_table: string;
  readonly source_column: string;
  readonly source_row_id: unknown;
  readonly row_store_id: unknown;
  readonly raw_reference: unknown;
  readonly parent_mismatch: unknown;
}

const ARTIFACT_ID_PATTERN =
  /^artifact:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Projects a complete, Main-only view of DB references relevant to the
 * current Store Capsule.
 *
 * Current-store references are never discarded because a parent association
 * is corrupt. Foreign-store absolute references that point into this capsule
 * are also retained, while both conditions emit blockers. Values stay raw so
 * the retention planner remains the only filesystem boundary authority.
 */
export function projectStoreEvidenceReferencePaths(
  database: Pick<Database.Database, 'prepare'>,
  storeIdInput: unknown,
  capsule: Pick<StoreCapsulePaths, 'storeRoot'>,
): StoreEvidenceDatabaseReferenceProjection {
  const storeId = normalizeStoreId(storeIdInput);
  const rows = database.prepare(`
    WITH store_reference_rows(
      source_table,
      source_column,
      source_row_id,
      row_store_id,
      raw_reference,
      parent_mismatch
    ) AS (
      SELECT
        'action_logs',
        'screenshot_before',
        CAST(logs.id AS TEXT),
        logs.store_id,
        logs.screenshot_before,
        CASE
          WHEN logs.recommendation_id IS NOT NULL
            AND (
              recommendation.id IS NULL
              OR recommendation.store_id IS NULL
              OR recommendation.store_id <> logs.store_id
            )
          THEN 1 ELSE 0
        END
      FROM action_logs logs
      LEFT JOIN action_recommendations recommendation
        ON recommendation.id = logs.recommendation_id

      UNION ALL

      SELECT
        'action_logs',
        'screenshot_after',
        CAST(logs.id AS TEXT),
        logs.store_id,
        logs.screenshot_after,
        CASE
          WHEN logs.recommendation_id IS NOT NULL
            AND (
              recommendation.id IS NULL
              OR recommendation.store_id IS NULL
              OR recommendation.store_id <> logs.store_id
            )
          THEN 1 ELSE 0
        END
      FROM action_logs logs
      LEFT JOIN action_recommendations recommendation
        ON recommendation.id = logs.recommendation_id

      UNION ALL

      SELECT
        'action_logs',
        'trace_path',
        CAST(logs.id AS TEXT),
        logs.store_id,
        logs.trace_path,
        CASE
          WHEN logs.recommendation_id IS NOT NULL
            AND (
              recommendation.id IS NULL
              OR recommendation.store_id IS NULL
              OR recommendation.store_id <> logs.store_id
            )
          THEN 1 ELSE 0
        END
      FROM action_logs logs
      LEFT JOIN action_recommendations recommendation
        ON recommendation.id = logs.recommendation_id

      UNION ALL

      SELECT
        'lingxing_report_files',
        'failure_screenshot_path',
        CAST(files.id AS TEXT),
        files.store_id,
        files.failure_screenshot_path,
        CASE
          WHEN batch.id IS NULL
            OR batch.store_id IS NULL
            OR batch.store_id <> files.store_id
          THEN 1 ELSE 0
        END
      FROM lingxing_report_files files
      LEFT JOIN lingxing_report_batches batch
        ON batch.id = files.batch_id

      UNION ALL

      SELECT
        'lingxing_report_files',
        'failure_trace_path',
        CAST(files.id AS TEXT),
        files.store_id,
        files.failure_trace_path,
        CASE
          WHEN batch.id IS NULL
            OR batch.store_id IS NULL
            OR batch.store_id <> files.store_id
          THEN 1 ELSE 0
        END
      FROM lingxing_report_files files
      LEFT JOIN lingxing_report_batches batch
        ON batch.id = files.batch_id

      UNION ALL

      SELECT
        'download_center_diagnostics',
        'screenshot_path',
        CAST(diagnostics.id AS TEXT),
        diagnostics.store_id,
        diagnostics.screenshot_path,
        0
      FROM download_center_diagnostics diagnostics

      UNION ALL

      SELECT
        'operation_events',
        'evidence_path',
        CAST(events.id AS TEXT),
        events.store_id,
        events.evidence_path,
        0
      FROM operation_events events

      UNION ALL

      SELECT
        'listing_content',
        'screenshot_path',
        CAST(content.id AS TEXT),
        content.store_id,
        content.screenshot_path,
        0
      FROM listing_content content

      UNION ALL

      SELECT
        'listing_content_versions',
        'screenshot_path',
        CAST(versions.id AS TEXT),
        versions.store_id,
        versions.screenshot_path,
        CASE
          WHEN versions.listing_content_id IS NOT NULL
            AND (
              content.id IS NULL
              OR content.store_id IS NULL
              OR content.store_id <> versions.store_id
            )
          THEN 1 ELSE 0
        END
      FROM listing_content_versions versions
      LEFT JOIN listing_content content
        ON content.id = versions.listing_content_id
    )
    SELECT
      source_table,
      source_column,
      source_row_id,
      row_store_id,
      raw_reference,
      parent_mismatch
    FROM store_reference_rows
    WHERE typeof(raw_reference) = 'text'
      AND trim(raw_reference) <> ''
    ORDER BY
      source_table COLLATE BINARY ASC,
      source_row_id COLLATE BINARY ASC,
      source_column COLLATE BINARY ASC,
      raw_reference COLLATE BINARY ASC
  `).all() as ReferenceRow[];

  const databaseReferencedPaths = new Set<string>();
  const artifactReferences = new Map<string, StoreEvidenceArtifactReference>();
  const blockers: StoreEvidenceRetentionBlocker[] = [];
  const mismatchRows = new Set<string>();

  for (const row of rows) {
    const rawReference = row.raw_reference as string;
    const rowStoreId = typeof row.row_store_id === 'string'
      ? row.row_store_id
      : '';
    const isCurrentStore = rowStoreId === storeId;
    const isArtifact = (
      row.source_table === 'operation_events'
      && row.source_column === 'evidence_path'
      && ARTIFACT_ID_PATTERN.test(rawReference)
    );

    if (isArtifact) {
      // Artifact capabilities are opaque, so SQL cannot prove which capsule
      // they resolve into. Preserve both current- and foreign-row references
      // for the Main registry to reconcile instead of silently dropping the
      // foreign case.
      artifactReferences.set(`${rowStoreId}\0${rawReference}`, {
        artifactId: rawReference,
        source: 'operation_events.evidence_path',
        referencedStoreId: rowStoreId,
        ownership: isCurrentStore ? 'current-store' : 'foreign-store',
      });
      continue;
    }

    if (isCurrentStore) {
      databaseReferencedPaths.add(rawReference);

      if (Number(row.parent_mismatch) === 1) {
        const mismatchKey = `${row.source_table}\0${String(row.source_row_id)}`;
        if (!mismatchRows.has(mismatchKey)) {
          mismatchRows.add(mismatchKey);
          blockers.push({
            code: 'DATABASE_REFERENCE_OWNERSHIP_MISMATCH',
            relativePath: '[database-reference]',
            detail: `${row.source_table} parent ownership does not match the current store`,
          });
        }
      }
      continue;
    }

    if (
      path.isAbsolute(rawReference)
      && isContained(capsule.storeRoot, rawReference)
    ) {
      databaseReferencedPaths.add(rawReference);
      blockers.push({
        code: 'CROSS_STORE_REFERENCE',
        relativePath: auditPath(capsule.storeRoot, rawReference),
        detail: `${row.source_table}.${row.source_column} is owned by another store`,
      });
    }
  }

  return Object.freeze({
    databaseReferencedPaths: Object.freeze(
      [...databaseReferencedPaths].sort(stableCompare),
    ),
    artifactReferences: Object.freeze(
      [...artifactReferences.values()].sort((left, right) => (
        stableCompare(left.artifactId, right.artifactId)
        || stableCompare(left.referencedStoreId, right.referencedStoreId)
      )),
    ),
    blockers: Object.freeze(deduplicateAndSortBlockers(blockers)),
  });
}

function isContained(rootInput: string, candidateInput: string): boolean {
  const root = path.resolve(rootInput);
  const candidate = path.resolve(candidateInput);
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function auditPath(root: string, candidate: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (relative || '.').split(path.sep).join('/');
}

function deduplicateAndSortBlockers(
  blockers: readonly StoreEvidenceRetentionBlocker[],
): StoreEvidenceRetentionBlocker[] {
  const unique = new Map<string, StoreEvidenceRetentionBlocker>();
  for (const blocker of blockers) {
    unique.set(`${blocker.code}\0${blocker.relativePath}\0${blocker.detail}`, blocker);
  }
  return [...unique.values()].sort((left, right) => (
    stableCompare(left.relativePath, right.relativePath)
    || stableCompare(left.code, right.code)
    || stableCompare(left.detail, right.detail)
  ));
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
