import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type StoreAdObjectListInput, type StoreScopedAdObjectFact, type StableAdEntityAuthority } from "./store-ad-listing-contracts";
import { AD_OBJECT_LIST_KEYS, AD_OBJECT_SHAPES } from "./store-ad-listing-constants";
import {
  requireObject,
  rejectUnknownKeys,
  normalizeAdObjectKind,
  optionalIsoDate,
  invalid,
  optionalAsin,
  optionalText,
  positiveLimit,
  escapeLike,
  nonEmptyString,
  finiteNumber,
  safeRatio,
} from "./store-ad-listing-input-values";
import { readableTargetName, uniqueStableAdEntityAuthority, stableAdEntityPathKey, adObjectKey } from "./store-ad-listing-identity-values";
import { loadCurrentStableAdEntityAuthorities } from "./store-ad-listing-entity-authority";
import { resolveProductionAdAuthority } from "./store-ad-listing-production-authority";
import { authorize, assertIdentityHints } from "./store-ad-listing-store-access";
import type { StoreAdListingRuntime } from './store-ad-listing-runtime';

export function listAdObjects(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope,
  input: StoreAdObjectListInput = {}): StoreScopedAdObjectFact[] {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'ad object list input');
    rejectUnknownKeys(value, AD_OBJECT_LIST_KEYS, 'ad object list input');
    this.assertIdentityHints(store, value);
    const kind = normalizeAdObjectKind(value.kind);
    const dateFrom = optionalIsoDate(value.dateFrom, 'dateFrom');
    const dateTo = optionalIsoDate(value.dateTo, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo) throw invalid('dateFrom must not be after dateTo');
    const asin = optionalAsin(value.asin);
    const query = optionalText(value.query, 'query', 120);
    const limit = positiveLimit(value.limit, 500, 1_000);
    const shape = AD_OBJECT_SHAPES[kind];
    const productionAuthority = this.resolveProductionAdAuthority(store.storeId, dateFrom, dateTo);
    if (!productionAuthority) return [];
    const selectedReportBatches = shape.reportTypes.flatMap((reportType) => {
      const batchId = productionAuthority.batchByReportType.get(reportType);
      return batchId ? [{ reportType, batchId }] : [];
    });
    if (selectedReportBatches.length === 0) return [];
    const clauses = [
      'store_id = ?',
      "upper(trim(marketplace_code)) = 'US'",
      "upper(trim(currency)) = 'USD'",
      `(${selectedReportBatches.map(() => '(report_type = ? AND batch_id = ?)').join(' OR ')})`,
      'date >= ?',
      'date <= ?',
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'ad_daily_metrics'
          AND quarantine.source_row_id = CAST(ad_daily_metrics.id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
      `${shape.nameExpression} IS NOT NULL`,
      `trim(${shape.nameExpression}) <> ''`,
    ];
    const parameters: unknown[] = [
      store.storeId,
      ...selectedReportBatches.flatMap(({ reportType, batchId }) => [reportType, batchId]),
      productionAuthority.dateStart,
      productionAuthority.dateEnd,
    ];
    if (dateFrom) {
      clauses.push('date >= ?');
      parameters.push(dateFrom);
    }
    if (dateTo) {
      clauses.push('date <= ?');
      parameters.push(dateTo);
    }
    if (asin) {
      clauses.push('upper(trim(asin)) = ?');
      parameters.push(asin);
    }
    if (query) {
      const like = `%${escapeLike(query)}%`;
      clauses.push(`(${shape.searchExpressions.map((expression) => `${expression} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      parameters.push(...shape.searchExpressions.map(() => like));
    }

    const rows = this.db.prepare(`
      SELECT
        ${shape.nameExpression} AS object_name,
        ${shape.campaignExpression} AS campaign_name,
        ${shape.adGroupExpression} AS ad_group_name,
        ${shape.matchTypeExpression} AS match_type,
        report_type AS authority_report_type,
        CASE
          WHEN COUNT(DISTINCT NULLIF(upper(trim(asin)), '')) = 1
          THEN MIN(NULLIF(upper(trim(asin)), ''))
          ELSE NULL
        END AS asin,
        MIN(date) AS first_date,
        MAX(date) AS last_date,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(cost), 0) AS spend,
        COALESCE(SUM(orders), 0) AS orders,
        COALESCE(SUM(sales), 0) AS sales,
        COUNT(*) AS source_row_count,
        GROUP_CONCAT(id, ',') AS source_metric_ids,
        COUNT(DISTINCT NULLIF(date, '')) AS observation_date_count,
        COUNT(DISTINCT NULLIF(source_file, '')) AS source_file_count,
        COUNT(DISTINCT NULLIF(report_type, '')) AS report_type_count
      FROM ad_daily_metrics
      WHERE ${clauses.join(' AND ')}
      GROUP BY ${shape.groupBy.join(', ')}
      ORDER BY spend DESC, clicks DESC, object_name COLLATE NOCASE
      LIMIT ?
    `).all(...parameters, limit) as Array<Record<string, unknown>>;
    const stableAuthorityByPath = kind === 'target'
      ? this.loadCurrentStableAdEntityAuthorities(
        store.storeId,
        contextInput.sessionGeneration,
        productionAuthority,
        selectedReportBatches,
      )
      : new Map<string, StableAdEntityAuthority[]>();

    return rows.map((row) => {
      const campaignName = nonEmptyString(row.campaign_name);
      const adGroupName = nonEmptyString(row.ad_group_name);
      const authorityReportType = nonEmptyString(row.authority_report_type);
      const rawName = nonEmptyString(row.object_name) ?? '未命名对象';
      const matchType = nonEmptyString(row.match_type)?.toLocaleLowerCase();
      const name = readableTargetName(rawName, authorityReportType, matchType);
      const spend = finiteNumber(row.spend);
      const sales = finiteNumber(row.sales);
      const clicks = finiteNumber(row.clicks);
      const orders = finiteNumber(row.orders);
      const sourceRowCount = finiteNumber(row.source_row_count);
      const hasUniqueObservableGrain = kind !== 'target'
        || sourceRowCount === finiteNumber(row.observation_date_count);
      const hasRequiredKeywordMatchType = authorityReportType !== 'keyword' || Boolean(matchType);
      const stableAuthority = kind === 'target'
        && authorityReportType
        && hasRequiredKeywordMatchType
        && hasUniqueObservableGrain
        ? uniqueStableAdEntityAuthority(stableAuthorityByPath.get(stableAdEntityPathKey(
          authorityReportType,
          campaignName,
          adGroupName,
          rawName,
          matchType,
        )), row.source_metric_ids, sourceRowCount)
        : undefined;
      return {
        storeId: store.storeId,
        marketplace: 'US',
        currency: 'USD',
        kind,
        objectKey: adObjectKey(
          kind,
          campaignName,
          adGroupName,
          rawName,
          kind === 'target' ? authorityReportType : undefined,
          kind === 'target' ? matchType : undefined,
        ),
        ...(stableAuthority
          ? {
            entityId: stableAuthority.entityId,
            entityRevision: stableAuthority.entityRevision,
            ...(stableAuthority.canonicalKeywordIdentity ?? {}),
            resolved: true,
            // 当前仅支持关键词出价；其他投放身份仍为只读事实。
            nonExecutable: authorityReportType !== 'keyword',
          }
          : {
            resolved: false,
            nonExecutable: true,
            resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE' as const,
          }),
        name,
        ...(matchType ? { matchType } : {}),
        campaignName,
        adGroupName,
        asin: nonEmptyString(row.asin)?.toUpperCase(),
        firstDate: nonEmptyString(row.first_date),
        lastDate: nonEmptyString(row.last_date),
        impressions: finiteNumber(row.impressions),
        clicks,
        spend,
        orders,
        sales,
        acos: safeRatio(spend, sales),
        cpc: safeRatio(spend, clicks),
        cvr: safeRatio(orders, clicks),
        sourceRowCount,
        sourceFileCount: finiteNumber(row.source_file_count),
        reportTypeCount: finiteNumber(row.report_type_count),
      };
    });
  }
