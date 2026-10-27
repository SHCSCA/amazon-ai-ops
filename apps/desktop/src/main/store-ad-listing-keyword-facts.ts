import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  type StoreKeywordFactListInput,
  type StoreScopedKeywordFact,
  type KeywordAggregateRow,
  type KeywordOpportunityRow,
} from "./store-ad-listing-contracts";
import { KEYWORD_FACT_LIST_KEYS } from "./store-ad-listing-constants";
import {
  requireObject,
  rejectUnknownKeys,
  optionalAsin,
  optionalText,
  positiveLimit,
  escapeLike,
  normalizeKeyword,
  nonEmptyString,
  keywordFactKey,
  finiteNumber,
  safeRatio,
  boundedOptionalText,
  parseStringArray,
} from "./store-ad-listing-input-values";
import { authorize, assertIdentityHints } from "./store-ad-listing-store-access";
import type { StoreAdListingRuntime } from './store-ad-listing-runtime';

export function listKeywordFacts(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope,
  input: StoreKeywordFactListInput = {}): StoreScopedKeywordFact[] {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'keyword fact list input');
    rejectUnknownKeys(value, KEYWORD_FACT_LIST_KEYS, 'keyword fact list input');
    this.assertIdentityHints(store, value);
    const asin = optionalAsin(value.asin);
    const query = optionalText(value.query, 'query', 120)?.toLocaleLowerCase();
    const limit = positiveLimit(value.limit, 500, 1_000);

    const metricClauses = [
      'store_id = ?',
      'normalized_keyword IS NOT NULL',
      "trim(normalized_keyword) <> ''",
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'keyword_metrics'
          AND quarantine.source_row_id = CAST(keyword_metrics.id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
    ];
    const metricParameters: unknown[] = [store.storeId];
    const opportunityClauses = [
      'store_id = ?',
      'normalized_keyword IS NOT NULL',
      "trim(normalized_keyword) <> ''",
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'keyword_opportunities'
          AND quarantine.source_row_id = CAST(keyword_opportunities.id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
    ];
    const opportunityParameters: unknown[] = [store.storeId];
    if (asin) {
      metricClauses.push('upper(trim(asin)) = ?');
      opportunityClauses.push('upper(trim(asin)) = ?');
      metricParameters.push(asin);
      opportunityParameters.push(asin);
    }
    if (query) {
      const like = `%${escapeLike(query)}%`;
      metricClauses.push("lower(trim(normalized_keyword)) LIKE ? ESCAPE '\\'");
      opportunityClauses.push("lower(trim(normalized_keyword)) LIKE ? ESCAPE '\\'");
      metricParameters.push(like);
      opportunityParameters.push(like);
    }
    const sourceLimit = Math.min(limit * 2, 2_000);

    const metrics = this.db.prepare(`
      SELECT
        NULLIF(upper(trim(asin)), '') AS asin,
        lower(trim(normalized_keyword)) AS normalized_keyword,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(cost), 0) AS spend,
        COALESCE(SUM(orders), 0) AS orders,
        COALESCE(SUM(sales), 0) AS sales,
        COUNT(*) AS source_row_count,
        MAX(created_at) AS last_observed_at
      FROM keyword_metrics
      WHERE ${metricClauses.join(' AND ')}
      GROUP BY NULLIF(upper(trim(asin)), ''), lower(trim(normalized_keyword))
      ORDER BY spend DESC, clicks DESC, normalized_keyword
      LIMIT ?
    `).all(...metricParameters, sourceLimit) as KeywordAggregateRow[];

    const opportunities = this.db.prepare(`
      SELECT
        NULLIF(upper(trim(asin)), '') AS asin,
        lower(trim(normalized_keyword)) AS normalized_keyword,
        opportunity_level,
        score,
        evidence,
        risk_flags_json,
        recommended_sections_json,
        status,
        updated_at
      FROM keyword_opportunities
      WHERE ${opportunityClauses.join(' AND ')}
      ORDER BY score DESC, updated_at DESC, id DESC
      LIMIT ?
    `).all(...opportunityParameters, sourceLimit) as KeywordOpportunityRow[];

    const facts = new Map<string, StoreScopedKeywordFact>();
    for (const row of metrics) {
      const keyword = normalizeKeyword(row.normalized_keyword);
      const rowAsin = nonEmptyString(row.asin)?.toUpperCase();
      const key = keywordFactKey(rowAsin, keyword);
      const spend = finiteNumber(row.spend);
      const sales = finiteNumber(row.sales);
      const clicks = finiteNumber(row.clicks);
      const orders = finiteNumber(row.orders);
      facts.set(key, {
        storeId: store.storeId,
        marketplace: 'US',
        currency: 'USD',
        keyword,
        asin: rowAsin,
        impressions: finiteNumber(row.impressions),
        clicks,
        spend,
        orders,
        sales,
        acos: safeRatio(spend, sales),
        cvr: safeRatio(orders, clicks),
        sourceRowCount: finiteNumber(row.source_row_count),
        riskFlags: [],
        recommendedSections: [],
        lastObservedAt: nonEmptyString(row.last_observed_at),
      });
    }
    for (const row of opportunities) {
      const keyword = normalizeKeyword(row.normalized_keyword);
      const rowAsin = nonEmptyString(row.asin)?.toUpperCase();
      const key = keywordFactKey(rowAsin, keyword);
      const existing = facts.get(key) ?? {
        storeId: store.storeId,
        marketplace: 'US' as const,
        currency: 'USD' as const,
        keyword,
        asin: rowAsin,
        impressions: 0,
        clicks: 0,
        spend: 0,
        orders: 0,
        sales: 0,
        acos: 0,
        cvr: 0,
        sourceRowCount: 0,
        riskFlags: [],
        recommendedSections: [],
      };
      // The query is newest-first. Do not let an older opportunity replace the
      // current store-owned projection for the same ASIN/keyword pair.
      if (existing.opportunityLevel === undefined) {
        facts.set(key, {
          ...existing,
          opportunityLevel: nonEmptyString(row.opportunity_level),
          opportunityScore: row.score === null ? undefined : finiteNumber(row.score),
          opportunityStatus: nonEmptyString(row.status),
          evidence: boundedOptionalText(row.evidence, 1_000),
          riskFlags: parseStringArray(row.risk_flags_json, 25, 120),
          recommendedSections: parseStringArray(row.recommended_sections_json, 25, 120),
          lastObservedAt: existing.lastObservedAt ?? nonEmptyString(row.updated_at),
        });
      }
    }

    return [...facts.values()]
      .filter((fact) => !asin || fact.asin === asin)
      .filter((fact) => !query || fact.keyword.toLocaleLowerCase().includes(query))
      .sort((left, right) => (
        (right.opportunityScore ?? -1) - (left.opportunityScore ?? -1)
        || right.spend - left.spend
        || right.clicks - left.clicks
        || left.keyword.localeCompare(right.keyword, 'en-US')
      ))
      .slice(0, limit);
  }
