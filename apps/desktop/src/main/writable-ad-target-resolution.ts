import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  AdReadbackAuthorityScope,
  WritableAdTargetEvidence,
  WritableAdEntityType,
} from '@amazon-ai-ops/shared-types';

export interface WritableAdTargetCandidate {
  entityType: unknown;
  entityId: unknown;
  sourceFile: unknown;
  sourceRow: unknown;
  identitySource: unknown;
  identityProofPath: unknown;
  verificationNote: unknown;
}

export interface ResolveWritableAdTargetAuthorityInput {
  scope: AdReadbackAuthorityScope;
  candidate: WritableAdTargetCandidate;
  allowedSourceFiles: string[];
  syntheticRecommendationEntityId: string;
  verifiedBy: string;
  verifiedAt: string;
}

export interface AssertCurrentWritableAdTargetAuthorityInput {
  scope: AdReadbackAuthorityScope;
  target: WritableAdTargetEvidence;
  allowedSourceFiles: string[];
  syntheticRecommendationEntityId: string;
}

const WRITABLE_ENTITY_TYPES = new Set<WritableAdEntityType>([
  'keyword',
  'auto_targeting',
  'product_targeting',
]);
const IDENTITY_SOURCES = new Set(['ads_ui', 'ads_api']);

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedText(value: unknown): string {
  return text(value).toLowerCase();
}

function canonicalExistingPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

function normalizedPath(filePath: unknown): string {
  return canonicalExistingPath(text(filePath)).replace(/\\/g, '/').toLowerCase();
}

function sourceFileCandidates(filePath: string): string[] {
  const resolved = path.resolve(filePath);
  return Array.from(new Set([filePath, resolved, canonicalExistingPath(resolved)]));
}

function fail(): never {
  throw new Error('复核被阻断：无法把当前证据唯一绑定到经身份核验的 Ads 可写对象。');
}

export function resolveWritableAdTargetAuthority(
  db: Database.Database,
  input: ResolveWritableAdTargetAuthorityInput,
): WritableAdTargetEvidence {
  const entityType = normalizedText(input.candidate.entityType) as WritableAdEntityType;
  const entityId = text(input.candidate.entityId);
  const sourceFile = text(input.candidate.sourceFile);
  const sourceRow = Number(input.candidate.sourceRow);
  const identitySource = normalizedText(input.candidate.identitySource) as 'ads_ui' | 'ads_api';
  const proofPath = text(input.candidate.identityProofPath);
  const verificationNote = text(input.candidate.verificationNote);
  const verifiedBy = text(input.verifiedBy);
  const verifiedAt = text(input.verifiedAt);
  const allowed = new Set(input.allowedSourceFiles.map(normalizedPath));

  if (
    !WRITABLE_ENTITY_TYPES.has(entityType)
    || !entityId
    || normalizedText(entityId) === normalizedText(input.syntheticRecommendationEntityId)
    || !sourceFile
    || !allowed.has(normalizedPath(sourceFile))
    || !Number.isInteger(sourceRow)
    || sourceRow <= 0
    || !IDENTITY_SOURCES.has(identitySource)
    || !proofPath
    || !fs.existsSync(path.resolve(proofPath))
    || !fs.statSync(path.resolve(proofPath)).isFile()
    || !verificationNote
    || !verifiedBy
    || !Number.isFinite(Date.parse(verifiedAt))
  ) {
    return fail();
  }

  const candidates = sourceFileCandidates(sourceFile);
  const rows = db.prepare(`
    SELECT
      date AS metricDate,
      campaign_name AS campaignName,
      ad_group_name AS adGroupName,
      targeting AS entityName,
      match_type AS matchType,
      source_file AS sourceFile,
      source_row AS sourceRow
    FROM ad_daily_metrics
    WHERE batch_id = ?
      AND report_type = ?
      AND date >= ?
      AND date <= ?
      AND COALESCE(store_name, '') = COALESCE(?, '')
      AND COALESCE(marketplace_code, '') = COALESCE(?, '')
      AND upper(COALESCE(asin, '')) = upper(?)
      AND source_file IN (${candidates.map(() => '?').join(', ')})
      AND source_row = ?
  `).all(
    text(input.scope.batchId),
    entityType,
    text(input.scope.dateFrom),
    text(input.scope.dateTo),
    text(input.scope.storeName),
    text(input.scope.marketplaceCode),
    text(input.scope.asin),
    ...candidates,
    sourceRow,
  ) as Array<{
    metricDate?: string;
    campaignName?: string;
    adGroupName?: string;
    entityName?: string;
    matchType?: string;
    sourceFile?: string;
    sourceRow?: number;
  }>;

  if (rows.length !== 1) return fail();
  const row = rows[0];
  if (!text(row.metricDate) || !text(row.campaignName) || !text(row.adGroupName) || !text(row.entityName)) {
    return fail();
  }

  return {
    entityType,
    entityId,
    entityName: text(row.entityName),
    campaignName: text(row.campaignName),
    adGroupName: text(row.adGroupName),
    metricDate: text(row.metricDate),
    sourceFile: canonicalExistingPath(text(row.sourceFile) || sourceFile),
    sourceRow: Number(row.sourceRow),
    identitySource,
    verifiedBy,
    verifiedAt: new Date(Date.parse(verifiedAt)).toISOString(),
    verificationNote,
    identityProofPath: canonicalExistingPath(proofPath),
  };
}

export function assertCurrentWritableAdTargetAuthority(
  db: Database.Database,
  input: AssertCurrentWritableAdTargetAuthorityInput,
): WritableAdTargetEvidence {
  const canonical = resolveWritableAdTargetAuthority(db, {
    scope: input.scope,
    candidate: input.target,
    allowedSourceFiles: input.allowedSourceFiles,
    syntheticRecommendationEntityId: input.syntheticRecommendationEntityId,
    verifiedBy: input.target.verifiedBy,
    verifiedAt: input.target.verifiedAt,
  });
  const target = input.target;
  const matches = canonical.entityType === target.entityType
    && canonical.entityId === text(target.entityId)
    && normalizedText(canonical.entityName) === normalizedText(target.entityName)
    && normalizedText(canonical.campaignName) === normalizedText(target.campaignName)
    && normalizedText(canonical.adGroupName) === normalizedText(target.adGroupName)
    && canonical.metricDate === text(target.metricDate)
    && normalizedPath(canonical.sourceFile) === normalizedPath(target.sourceFile)
    && canonical.sourceRow === Number(target.sourceRow)
    && canonical.identitySource === target.identitySource
    && canonical.verifiedBy === text(target.verifiedBy)
    && canonical.verifiedAt === new Date(Date.parse(text(target.verifiedAt))).toISOString()
    && canonical.verificationNote === text(target.verificationNote)
    && normalizedPath(canonical.identityProofPath) === normalizedPath(target.identityProofPath);
  if (!matches) return fail();
  return canonical;
}
