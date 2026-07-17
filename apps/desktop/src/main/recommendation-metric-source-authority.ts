import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  ActionRecommendation,
  RecommendationReviewScope,
} from '@amazon-ai-ops/shared-types';
import type { RecommendationMetricSourceAuthority } from './recommendation-writable-target-policy';

export interface AssertRecommendationMetricSourceAuthorityInput {
  recommendation: ActionRecommendation;
  scope: RecommendationReviewScope;
  allowedSourceFiles: string[];
}

const WRITABLE_REPORT_TYPES = new Set([
  'keyword',
  'auto_targeting',
  'product_targeting',
]);

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalized(value: unknown): string {
  return text(value).toLowerCase();
}

function normalizedAsin(value: unknown): string {
  return text(value).toUpperCase();
}

function canonicalExistingPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

function normalizedPath(value: unknown): string {
  const filePath = text(value);
  return filePath ? canonicalExistingPath(filePath).replace(/\\/g, '/').toLowerCase() : '';
}

function sourceFileCandidates(filePath: string): string[] {
  const resolved = path.resolve(filePath);
  return Array.from(new Set([filePath, resolved, canonicalExistingPath(resolved)]));
}

function fail(reason: string): never {
  throw new Error(`建议来源权威核验被阻断：${reason}`);
}

function recommendationObjectName(recommendation: ActionRecommendation): string {
  return normalized(
    recommendation.evidence?.searchTerm
      || recommendation.evidence?.targeting
      || recommendation.entityName,
  );
}

export function assertRecommendationMetricSourceAuthority(
  db: Database.Database,
  input: AssertRecommendationMetricSourceAuthorityInput,
): RecommendationMetricSourceAuthority {
  const { recommendation, scope } = input;
  const evidence = recommendation.evidence || {};
  const sourceRow = Number(evidence.sourceRow);
  const explicitSourceFile = text(evidence.sourceFile);
  const evidenceSourceFiles = Array.isArray(evidence.sourceFiles)
    ? evidence.sourceFiles.map(text).filter(Boolean)
    : [];
  const sourceFiles = explicitSourceFile ? [explicitSourceFile] : evidenceSourceFiles;
  if (!Number.isInteger(sourceRow) || sourceRow <= 0 || sourceFiles.length === 0) {
    return fail('建议缺少可唯一回查的来源文件与来源行，请基于当前真实报表重新生成。');
  }

  const allowed = new Set(input.allowedSourceFiles.map(normalizedPath).filter(Boolean));
  if (!allowed.size || sourceFiles.some((filePath) => !allowed.has(normalizedPath(filePath)))) {
    return fail('建议来源文件不属于当前真实报表批次。');
  }
  if (explicitSourceFile && evidenceSourceFiles.length > 0
    && !evidenceSourceFiles.some((filePath) => normalizedPath(filePath) === normalizedPath(explicitSourceFile))) {
    return fail('建议的原子来源文件与来源文件集合不一致。');
  }
  if (
    normalized(recommendation.storeName) !== normalized(scope.storeName)
    || normalized(recommendation.marketplaceCode) !== normalized(scope.marketplaceCode)
    || normalizedAsin(recommendation.asin || evidence.asin) !== normalizedAsin(scope.asin)
    || text(evidence.batchId) !== text(scope.batchId)
  ) {
    return fail('建议与当前锁定范围或批次不一致。');
  }

  const candidates = Array.from(new Set(sourceFiles.flatMap(sourceFileCandidates)));
  const rows = db.prepare(`
    SELECT
      report_type AS reportType,
      date AS metricDate,
      campaign_name AS campaignName,
      ad_group_name AS adGroupName,
      targeting AS targeting,
      search_term AS searchTerm,
      source_file AS sourceFile,
      source_row AS sourceRow
    FROM ad_daily_metrics
    WHERE batch_id = ?
      AND date >= ?
      AND date <= ?
      AND COALESCE(store_name, '') = COALESCE(?, '')
      AND COALESCE(marketplace_code, '') = COALESCE(?, '')
      AND upper(COALESCE(asin, '')) = upper(?)
      AND source_file IN (${candidates.map(() => '?').join(', ')})
      AND source_row = ?
  `).all(
    text(scope.batchId),
    text(scope.dateFrom),
    text(scope.dateTo),
    text(scope.storeName),
    text(scope.marketplaceCode),
    text(scope.asin),
    ...candidates,
    sourceRow,
  ) as Array<{
    reportType?: string;
    metricDate?: string;
    campaignName?: string;
    adGroupName?: string;
    targeting?: string;
    searchTerm?: string;
    sourceFile?: string;
    sourceRow?: number;
  }>;

  if (rows.length !== 1) {
    return fail(`来源文件与行号必须唯一命中 1 条当前批次指标，实际命中 ${rows.length} 条。`);
  }
  const row = rows[0];
  const reportType = normalized(row.reportType);
  const entityName = text(row.targeting);
  if (!WRITABLE_REPORT_TYPES.has(reportType)) {
    return fail(`来源报表类型 ${reportType || 'unknown'} 不能直接授权首个降低竞价动作。`);
  }
  if (!entityName || !text(row.campaignName) || !text(row.adGroupName) || !text(row.metricDate) || !text(row.sourceFile)) {
    return fail('来源指标缺少可写对象所需的活动、广告组、投放对象或来源信息。');
  }
  if (text(evidence.reportType) && normalized(evidence.reportType) !== reportType) {
    return fail('建议记录的来源报表类型与当前数据库权威行不一致。');
  }
  if (
    normalized(evidence.campaignName) !== normalized(row.campaignName)
    || normalized(evidence.adGroupName) !== normalized(row.adGroupName)
    || recommendationObjectName(recommendation) !== normalized(entityName)
  ) {
    return fail('建议对象与当前数据库来源行不一致。');
  }
  if (explicitSourceFile && normalizedPath(explicitSourceFile) !== normalizedPath(row.sourceFile)) {
    return fail('建议记录的原子来源文件与当前数据库权威行不一致。');
  }

  return {
    reportType,
    entityName,
    campaignName: text(row.campaignName),
    adGroupName: text(row.adGroupName),
    metricDate: text(row.metricDate),
    sourceFile: canonicalExistingPath(text(row.sourceFile)),
    sourceRow: Number(row.sourceRow),
  };
}
