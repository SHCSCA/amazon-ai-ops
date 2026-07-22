import type Database from 'better-sqlite3';
import { RecommendationRepository } from '@amazon-ai-ops/local-db';
import type {
  ActionRecommendation,
  RecommendationReviewResolution,
  StoreContextEnvelope,
  WritableAdTargetBinding,
  WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import { assertRecommendationMetricSourceAuthority } from './recommendation-metric-source-authority';
import { getRecommendationWritableTargetOwnershipBlockers } from './recommendation-writable-target-policy';
import { assertCurrentWritableAdTargetAuthority } from './writable-ad-target-resolution';

type LegacyBindingAudit = WritableAdTargetBinding | RecommendationReviewResolution;

export interface RegisteredAdEntityAuthorityReader {
  getLatestVerifiedAdEntityById(context: StoreContextEnvelope, adEntityId: string): unknown;
}

/** Registry errors are authoritative failures and must never downgrade to legacy evidence. */
export function currentAdEntityBelongsToStore(
  repository: RegisteredAdEntityAuthorityReader,
  db: Database.Database,
  context: StoreContextEnvelope,
  adEntityId: string,
): boolean {
  const registered = repository.getLatestVerifiedAdEntityById(context, adEntityId);
  if (registered) return true;
  return legacyWritableAdEntityBelongsToStore(db, context, adEntityId);
}

/**
 * Bootstrap validator used before a Stage 5 Ads identity has been promoted into
 * the path-free authority registry. It accepts only a current, store-scoped
 * recommendation binding that can still be re-derived from one completed
 * Lingxing import and one existing visible-Ads identity proof.
 */
export function legacyWritableAdEntityBelongsToStore(
  db: Database.Database,
  context: StoreContextEnvelope,
  adEntityIdInput: string,
): boolean {
  const adEntityId = String(adEntityIdInput ?? '').trim();
  if (!adEntityId) return false;
  const rows = db.prepare(`
    SELECT id
    FROM action_recommendations
    WHERE store_id = ?
      AND marketplace_code = 'US'
      AND status = 'pending'
      AND json_extract(evidence_json, '$.writableTarget.entityId') = ?
    ORDER BY updated_at DESC, id DESC
  `).all(context.storeId, adEntityId) as Array<{ id: number }>;
  const repository = new RecommendationRepository(db);
  return rows.some((row) => {
    const recommendation = repository.findByIdForStore(context.storeId, Number(row.id));
    if (!recommendation) return false;
    try {
      assertLegacyBindingCurrent(db, context, recommendation, adEntityId);
      return true;
    } catch {
      return false;
    }
  });
}

function assertLegacyBindingCurrent(
  db: Database.Database,
  context: StoreContextEnvelope,
  recommendation: ActionRecommendation,
  adEntityId: string,
): void {
  const evidence = recommendation.evidence;
  const target = evidence?.writableTarget;
  const audit = evidence?.writableTargetBinding ?? evidence?.reviewResolution;
  if (!target || !audit || target.entityId !== adEntityId) throw new Error('missing current target binding');
  if (!isCurrentAudit(recommendation, audit, target)) throw new Error('stale target binding audit');

  const batchId = requiredText(evidence.batchId);
  const batch = db.prepare(`
    SELECT date_start AS dateFrom, date_end AS dateTo,
           store_name AS storeName, marketplace_code AS marketplaceCode
    FROM lingxing_report_batches
    WHERE store_id = ? AND id = ? AND status = 'completed'
  `).get(context.storeId, batchId) as {
    dateFrom: string;
    dateTo: string;
    storeName: string;
    marketplaceCode: string;
  } | undefined;
  if (!batch || batch.marketplaceCode !== 'US') throw new Error('completed US batch missing');

  const run = db.prepare(`
    SELECT run_id AS runId
    FROM report_import_runs
    WHERE store_id = ? AND batch_id = ? AND status = 'completed'
    ORDER BY completed_at DESC, run_id DESC
    LIMIT 1
  `).get(context.storeId, batchId) as { runId: string } | undefined;
  if (!run) throw new Error('completed import missing');
  const allowedSourceFiles = (db.prepare(`
    SELECT file_path AS filePath
    FROM report_import_file_snapshots
    WHERE store_id = ? AND run_id = ? AND batch_id = ?
  `).all(context.storeId, run.runId, batchId) as Array<{ filePath: string }>)
    .map((row) => row.filePath);
  if (allowedSourceFiles.length === 0) throw new Error('import snapshots missing');

  const scope = {
    dateFrom: batch.dateFrom,
    dateTo: batch.dateTo,
    storeName: batch.storeName,
    marketplaceCode: 'US',
    asin: recommendation.asin,
    batchId,
  };
  assertAuditScope(audit, scope, recommendation);
  const sourceAuthority = assertRecommendationMetricSourceAuthority(db, {
    recommendation,
    scope,
    allowedSourceFiles,
  });
  const canonical = assertCurrentWritableAdTargetAuthority(db, {
    scope,
    target,
    allowedSourceFiles,
    syntheticRecommendationEntityId: recommendation.entityId,
  });
  if (getRecommendationWritableTargetOwnershipBlockers(
    recommendation,
    canonical,
    sourceAuthority,
  ).length > 0) {
    throw new Error('target ownership mismatch');
  }
}

function isCurrentAudit(
  recommendation: ActionRecommendation,
  audit: LegacyBindingAudit,
  target: WritableAdTargetEvidence,
): boolean {
  const revision = Number(recommendation.revision ?? 0);
  if (audit.schemaVersion !== 1 || recommendation.status !== 'pending') return false;
  const auditTarget = audit.writableTarget;
  if (!sameTarget(auditTarget, target)) return false;
  if ('boundRevision' in audit) {
    return audit.fromRevision + 1 === audit.boundRevision && audit.boundRevision === revision;
  }
  return audit.fromStatus === 'needs_review'
    && audit.fromRevision + 1 === audit.resolvedRevision
    && audit.resolvedRevision === revision;
}

function assertAuditScope(
  audit: LegacyBindingAudit,
  scope: {
    dateFrom: string;
    dateTo: string;
    storeName: string;
    marketplaceCode: string;
    asin: string;
    batchId: string;
  },
  recommendation: ActionRecommendation,
): void {
  if (
    audit.scope.dateFrom !== scope.dateFrom
    || audit.scope.dateTo !== scope.dateTo
    || normalized(audit.scope.storeName) !== normalized(scope.storeName)
    || audit.scope.marketplaceCode !== 'US'
    || normalized(audit.scope.asin) !== normalized(scope.asin)
    || audit.scope.batchId !== scope.batchId
    || audit.metricSource.batchId !== scope.batchId
    || Number(audit.metricSource.sourceRow) !== Number(recommendation.evidence.sourceRow)
  ) throw new Error('binding scope mismatch');
  const left = audit.metricSource.sourceFiles.map(normalizedPath).sort();
  const right = (recommendation.evidence.sourceFiles ?? []).map(normalizedPath).sort();
  if (left.length === 0 || left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new Error('binding source mismatch');
  }
}

function sameTarget(left: WritableAdTargetEvidence, right: WritableAdTargetEvidence): boolean {
  return left.entityType === right.entityType
    && left.entityId === right.entityId
    && normalized(left.entityName) === normalized(right.entityName)
    && normalized(left.campaignName) === normalized(right.campaignName)
    && normalized(left.adGroupName) === normalized(right.adGroupName)
    && left.metricDate === right.metricDate
    && normalizedPath(left.sourceFile) === normalizedPath(right.sourceFile)
    && Number(left.sourceRow) === Number(right.sourceRow)
    && left.identitySource === right.identitySource
    && left.verifiedBy === right.verifiedBy
    && left.verifiedAt === right.verifiedAt
    && left.verificationNote === right.verificationNote
    && normalizedPath(left.identityProofPath) === normalizedPath(right.identityProofPath);
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizedPath(value: unknown): string {
  return normalized(value).replace(/\\/g, '/');
}

function requiredText(value: unknown): string {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) throw new Error('required value missing');
  return normalizedValue;
}
