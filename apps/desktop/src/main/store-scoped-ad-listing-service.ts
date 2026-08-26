import { createHash } from 'crypto';
import type { Database } from 'better-sqlite3';
import {
  canonicalizeAmazonAsin,
  inspectAmazonAsin,
  type LingxingReportType,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';

type StoreIdentityHints = {
  storeName?: unknown;
  store_name?: unknown;
  marketplace?: unknown;
  marketplaceCode?: unknown;
  marketplace_code?: unknown;
  currency?: unknown;
};

export type StoreScopedAdObjectKind = 'campaign' | 'ad_group' | 'target' | 'search_term';

export interface StoreScopedAdObjectFact {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  kind: StoreScopedAdObjectKind;
  objectKey: string;
  entityId?: string;
  entityRevision?: number;
  adsAccountId?: string;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  objectRevision?: number;
  resolved: boolean;
  nonExecutable: boolean;
  resolutionReason?: 'STABLE_ENTITY_ID_UNAVAILABLE';
  name: string;
  matchType?: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  firstDate?: string;
  lastDate?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  cpc: number;
  cvr: number;
  sourceRowCount: number;
  sourceFileCount: number;
  reportTypeCount: number;
}

export interface StoreScopedKeywordFact {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  keyword: string;
  asin?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  cvr: number;
  sourceRowCount: number;
  opportunityLevel?: string;
  opportunityScore?: number;
  opportunityStatus?: string;
  evidence?: string;
  riskFlags: string[];
  recommendedSections: string[];
  lastObservedAt?: string;
}

export interface VersionedStoreListingContent {
  id: number;
  storeId: StoreId;
  storeName: string;
  marketplace: 'US';
  currency: 'USD';
  asin: string;
  asinValid: boolean;
  title: string;
  bullets: string[];
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
}

export interface StoreListingContentVersion {
  id: number;
  listingContentId?: number;
  storeId: StoreId;
  asin: string;
  asinValid: boolean;
  title: string;
  bullets: string[];
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
  createdAt: string;
}

export interface StoreAdObjectListInput extends StoreIdentityHints {
  kind?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  asin?: unknown;
  query?: unknown;
  limit?: unknown;
}

export interface StoreKeywordFactListInput extends StoreIdentityHints {
  asin?: unknown;
  query?: unknown;
  limit?: unknown;
}

export interface StoreListingContentListInput extends StoreIdentityHints {
  asin?: unknown;
  query?: unknown;
  limit?: unknown;
}

export interface StoreListingContentLookupInput extends StoreIdentityHints {
  id?: unknown;
  asin?: unknown;
}

export interface StoreListingContentCreateInput extends StoreIdentityHints {
  asin: unknown;
  title?: unknown;
  bullets?: unknown;
  description?: unknown;
  aPlus?: unknown;
  a_plus?: unknown;
  imageCopy?: unknown;
  image_copy?: unknown;
  backendTerms?: unknown;
  backend_terms?: unknown;
  source?: unknown;
  versionLabel?: unknown;
  version_label?: unknown;
  changeSummary?: unknown;
  change_summary?: unknown;
}

export interface StoreListingContentUpdateInput {
  id: unknown;
  expectedRevision?: unknown;
  patch: unknown;
}

export interface StoreListingContentDeleteInput {
  id: unknown;
  expectedRevision?: unknown;
}

export interface StoreListingVersionListInput extends StoreIdentityHints {
  listingContentId?: unknown;
  asin?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export type StoreScopedAdListingErrorCode =
  | 'INVALID_INPUT'
  | 'STORE_IDENTITY_MISMATCH'
  | 'OBJECT_NOT_FOUND'
  | 'OBJECT_ALREADY_EXISTS'
  | 'CAS_REQUIRED'
  | 'OBJECT_CONFLICT'
  | 'WRITE_FAILED';

export class StoreScopedAdListingError extends Error {
  constructor(readonly code: StoreScopedAdListingErrorCode, message: string) {
    super(message);
    this.name = 'StoreScopedAdListingError';
  }
}

export interface StoreScopedAdListingServiceOptions {
  db: Database;
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getStore'>;
}

type ListingRow = {
  id: number;
  store_id: string;
  store_name: string | null;
  marketplace_code: string | null;
  asin: string;
  title: string | null;
  bullets_json: string | null;
  description: string | null;
  a_plus: string | null;
  image_copy: string | null;
  backend_terms: string | null;
  source: string | null;
  version_label: string | null;
  change_summary: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type KeywordAggregateRow = {
  asin: string | null;
  normalized_keyword: string;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  orders: number | null;
  sales: number | null;
  source_row_count: number | null;
  last_observed_at: string | null;
};

type KeywordOpportunityRow = {
  asin: string | null;
  normalized_keyword: string;
  opportunity_level: string | null;
  score: number | null;
  evidence: string | null;
  risk_flags_json: string | null;
  recommended_sections_json: string | null;
  status: string | null;
  updated_at: string | null;
};

type ProductionLineageJobRow = {
  job_id: string;
  date_start: string;
  date_end: string;
  report_types_json: string;
  snapshot_json: string;
  created_at: string;
};

type ProductionLineage = {
  lineageId: string;
  rootJobId: string;
  parentJobId?: string;
  expectedReportTypes: LingxingReportType[];
  purpose: 'production_full' | 'resume' | 'retry';
};

type ProductionLineageJob = {
  jobId: string;
  dateStart: string;
  dateEnd: string;
  reportTypes: LingxingReportType[];
  lineage?: ProductionLineage;
  createdAt: string;
};

type ProductionImportProofRow = {
  batchId: string;
  reportType: string;
  runCompletedAt: string;
};

type ProductionAdAuthority = {
  dateStart: string;
  dateEnd: string;
  batchByReportType: ReadonlyMap<LingxingReportType, string>;
};

type StableAdEntityAuthorityRow = {
  authority_id: string;
  ad_entity_id: string;
  entity_revision: number;
  source_report_type: string;
  entity_name: string;
  campaign_name: string;
  ad_group_name: string;
  match_type: string | null;
  ads_account_id: string | null;
  campaign_id: string | null;
  ad_group_id: string | null;
  keyword_id: string | null;
  object_revision: number | null;
};

type CanonicalKeywordIdentity = {
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  objectRevision: number;
};

type StableAdEntityAuthority = {
  entityId: string;
  entityRevision: number;
  canonicalKeywordIdentity?: CanonicalKeywordIdentity;
};

/**
 * Main-only store authority boundary for imported advertising facts and local
 * Listing content. All reads require the current full StoreContextEnvelope and
 * use store_id equality. Every pending-quarantined row is intentionally
 * invisible even when a legacy row still carries a non-NULL candidate store;
 * this service never repairs or deletes quarantine evidence.
 */
export class StoreScopedAdListingService {
  private readonly db: Database;
  private readonly storeCoordinator: StoreScopedAdListingServiceOptions['storeCoordinator'];

  constructor(options: StoreScopedAdListingServiceOptions) {
    this.db = options.db;
    this.storeCoordinator = options.storeCoordinator;
  }

  listAdObjects(
    contextInput: StoreContextEnvelope,
    input: StoreAdObjectListInput = {},
  ): StoreScopedAdObjectFact[] {
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
        || sourceRowCount === 1;
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
        )))
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
            // V1 execution only supports keyword bid changes. Auto/product
            // targeting identities remain useful read-only facts but must not
            // enter a set_keyword_bid policy allowlist.
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

  private loadCurrentStableAdEntityAuthorities(
    storeId: StoreId,
    sessionGeneration: number,
    productionAuthority: ProductionAdAuthority,
    selectedReportBatches: readonly { reportType: LingxingReportType; batchId: string }[],
  ): Map<string, StableAdEntityAuthority[]> {
    const writableReportBatches = selectedReportBatches.filter(
      (item): item is { reportType: 'keyword' | 'auto_targeting' | 'product_targeting'; batchId: string } => (
        item.reportType === 'keyword'
        || item.reportType === 'auto_targeting'
        || item.reportType === 'product_targeting'
      ),
    );
    if (writableReportBatches.length === 0) return new Map();
    const rows = this.db.prepare(`
      SELECT DISTINCT
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
      ...writableReportBatches.flatMap(({ reportType, batchId }) => [reportType, batchId]),
      productionAuthority.dateStart,
      productionAuthority.dateEnd,
    ) as StableAdEntityAuthorityRow[];
    const byPath = new Map<string, StableAdEntityAuthority[]>();
    for (const row of rows) {
      const entityId = nonEmptyString(row.ad_entity_id);
      const entityRevision = Number(row.entity_revision);
      if (!entityId || !Number.isInteger(entityRevision) || entityRevision < 1) continue;
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
        entityId,
        entityRevision,
        ...(canonicalKeywordIdentity ? { canonicalKeywordIdentity } : {}),
      });
      byPath.set(key, candidates);
    }
    return byPath;
  }

  private resolveProductionAdAuthority(
    storeId: StoreId,
    dateFrom: string | undefined,
    dateTo: string | undefined,
  ): ProductionAdAuthority | undefined {
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

  listKeywordFacts(
    contextInput: StoreContextEnvelope,
    input: StoreKeywordFactListInput = {},
  ): StoreScopedKeywordFact[] {
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

  listListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentListInput = {},
  ): VersionedStoreListingContent[] {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content list input');
    rejectUnknownKeys(value, LISTING_LIST_KEYS, 'listing content list input');
    this.assertIdentityHints(store, value);
    const asin = optionalAsin(value.asin);
    const query = optionalText(value.query, 'query', 120);
    const limit = positiveLimit(value.limit, 250, 1_000);
    const clauses = [
      'listing.store_id = ?',
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'listing_content'
          AND quarantine.source_row_id = CAST(listing.id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
    ];
    const parameters: unknown[] = [store.storeId];
    if (asin) {
      clauses.push('upper(trim(listing.asin)) = ?');
      parameters.push(asin);
    }
    if (query) {
      const like = `%${escapeLike(query)}%`;
      clauses.push("(listing.asin LIKE ? ESCAPE '\\' OR listing.title LIKE ? ESCAPE '\\')");
      parameters.push(like, like);
    }
    const rows = this.db.prepare(`
      SELECT listing.* FROM listing_content listing
      WHERE ${clauses.join(' AND ')}
      ORDER BY listing.updated_at DESC, listing.id DESC
      LIMIT ?
    `).all(...parameters, limit) as ListingRow[];
    return rows.map((row) => this.projectListing(store, row));
  }

  getListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentLookupInput,
  ): VersionedStoreListingContent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content lookup input');
    rejectUnknownKeys(value, LISTING_LOOKUP_KEYS, 'listing content lookup input');
    this.assertIdentityHints(store, value);
    const hasId = value.id !== undefined;
    const hasAsin = value.asin !== undefined;
    if (hasId === hasAsin) throw invalid('listing lookup requires exactly one of id or asin');
    const row = hasId
      ? this.findListingById(store.storeId, positiveInteger(value.id, 'listing content id'))
      : this.findListingByAsin(store.storeId, normalizeAsin(value.asin));
    if (!row) throw notFound('listing content');
    return this.projectListing(store, row);
  }

  createListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentCreateInput,
  ): VersionedStoreListingContent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content create input');
    rejectUnknownKeys(value, LISTING_CREATE_KEYS, 'listing content create input');
    this.assertIdentityHints(store, value);
    const normalized = normalizeListingCreate(value);
    const create = this.db.transaction(() => {
      if (this.findListingByAsin(store.storeId, normalized.asin)) {
        throw new StoreScopedAdListingError(
          'OBJECT_ALREADY_EXISTS',
          `listing content for ${normalized.asin} already exists in the active store`,
        );
      }
      const result = this.db.prepare(`
        INSERT INTO listing_content (
          store_id, store_name, marketplace_code, asin, title, bullets_json,
          description, a_plus, image_copy, backend_terms, source,
          version_label, change_summary, created_at, updated_at
        ) VALUES (?, ?, 'US', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW}, ${SQL_NOW})
      `).run(
        store.storeId,
        store.displayName,
        normalized.asin,
        normalized.title,
        JSON.stringify(normalized.bullets),
        normalized.description,
        normalized.aPlus,
        normalized.imageCopy,
        normalized.backendTerms,
        normalized.source,
        normalized.versionLabel,
        normalized.changeSummary,
      );
      const row = this.findListingById(store.storeId, Number(result.lastInsertRowid));
      if (!row) throw writeFailed('created listing content cannot be read back');
      this.insertListingVersion(store, row);
      return this.projectListing(store, row);
    });
    try {
      return create.immediate();
    } catch (error) {
      if (isSqliteConstraint(error)) {
        throw new StoreScopedAdListingError(
          'OBJECT_ALREADY_EXISTS',
          `listing content for ${normalized.asin} conflicts with the store ASIN authority`,
        );
      }
      throw error;
    }
  }

  updateListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentUpdateInput,
  ): VersionedStoreListingContent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content update input');
    rejectUnknownKeys(value, LISTING_UPDATE_KEYS, 'listing content update input');
    const id = positiveInteger(value.id, 'listing content id');
    const patch = requireObject(value.patch, 'listing content patch');
    rejectUnknownKeys(patch, LISTING_PATCH_KEYS, 'listing content patch');
    this.assertIdentityHints(store, patch);
    if (Object.keys(patch).every((key) => IDENTITY_HINT_KEYS.has(key))) {
      throw invalid('listing content update requires at least one editable field');
    }

    return this.db.transaction(() => {
      const current = this.findListingById(store.storeId, id);
      if (!current) throw notFound('listing content');
      const projected = this.projectListing(store, current);
      assertExpectedRevision(value.expectedRevision, projected.revision);
      if (!projected.asinValid) {
        throw invalid('historical Listing has an invalid ASIN and is read-only until reconciled');
      }
      if (patch.asin !== undefined && normalizeAsinForWrite(patch.asin) !== projected.asin) {
        throw invalid('changing a Listing ASIN is not supported; create a new object instead');
      }
      const next = mergeListingPatch(projected, patch);
      const result = this.db.prepare(`
        UPDATE listing_content
        SET title = ?, bullets_json = ?, description = ?, a_plus = ?,
            image_copy = ?, backend_terms = ?, source = ?, version_label = ?,
            change_summary = ?, store_name = ?, marketplace_code = 'US',
            updated_at = ${SQL_NOW}
        WHERE id = ? AND store_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM store_migration_quarantine quarantine
            WHERE quarantine.source_table = 'listing_content'
              AND quarantine.source_row_id = CAST(listing_content.id AS TEXT)
              AND quarantine.status = 'pending'
          )
      `).run(
        next.title,
        JSON.stringify(next.bullets),
        next.description,
        next.aPlus,
        next.imageCopy,
        next.backendTerms,
        next.source,
        next.versionLabel,
        next.changeSummary,
        store.displayName,
        id,
        store.storeId,
      );
      if (result.changes !== 1) throw writeFailed('listing content update was not applied');
      const updated = this.findListingById(store.storeId, id);
      if (!updated) throw writeFailed('updated listing content cannot be read back');
      this.insertListingVersion(store, updated);
      return this.projectListing(store, updated);
    }).immediate();
  }

  deleteListingContent(
    contextInput: StoreContextEnvelope,
    input: StoreListingContentDeleteInput,
  ): { id: number; deleted: true } {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content delete input');
    rejectUnknownKeys(value, LISTING_DELETE_KEYS, 'listing content delete input');
    const id = positiveInteger(value.id, 'listing content id');
    return this.db.transaction(() => {
      const current = this.findListingById(store.storeId, id);
      if (!current) throw notFound('listing content');
      const projected = this.projectListing(store, current);
      assertExpectedRevision(value.expectedRevision, projected.revision);
      if (!projected.asinValid) {
        throw invalid('historical Listing has an invalid ASIN and cannot be deleted until reconciled');
      }
      const result = this.db.prepare(`
        DELETE FROM listing_content
        WHERE id = ? AND store_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM store_migration_quarantine quarantine
            WHERE quarantine.source_table = 'listing_content'
              AND quarantine.source_row_id = CAST(listing_content.id AS TEXT)
              AND quarantine.status = 'pending'
          )
      `).run(id, store.storeId);
      if (result.changes !== 1) throw writeFailed('listing content delete was not applied');
      return { id, deleted: true as const };
    }).immediate();
  }

  listListingVersions(
    contextInput: StoreContextEnvelope,
    input: StoreListingVersionListInput = {},
  ): StoreListingContentVersion[] {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing version list input');
    rejectUnknownKeys(value, LISTING_VERSION_LIST_KEYS, 'listing version list input');
    this.assertIdentityHints(store, value);
    const clauses = [
      'version.store_id = ?',
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'listing_content_versions'
          AND quarantine.source_row_id = CAST(version.id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'listing_content'
          AND quarantine.source_row_id = CAST(version.listing_content_id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
    ];
    const parameters: unknown[] = [store.storeId];
    const hasListingContentId = value.listingContentId !== undefined;
    if (hasListingContentId) {
      clauses.push('version.listing_content_id = ?');
      parameters.push(positiveInteger(value.listingContentId, 'listing content id'));
    }
    // An id is the durable historical identity. In particular, migrated rows
    // may intentionally retain a legacy ASIN that no longer passes the write
    // validator. Never normalize that display value when the caller already
    // supplied the authoritative listing_content_id.
    if (!hasListingContentId && value.asin !== undefined) {
      clauses.push('upper(trim(version.asin)) = ?');
      parameters.push(normalizeAsin(value.asin));
    }
    const limit = positiveLimit(value.limit, 100, 500);
    const offset = nonNegativeInteger(value.offset, 'offset');
    const rows = this.db.prepare(`
      SELECT version.* FROM listing_content_versions version
      WHERE ${clauses.join(' AND ')}
      ORDER BY version.created_at DESC, version.id DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: positiveInteger(row.id, 'listing version id'),
      listingContentId: row.listing_content_id === null || row.listing_content_id === undefined
        ? undefined
        : positiveInteger(row.listing_content_id, 'listing content id'),
      storeId: store.storeId,
      asin: inspectAmazonAsin(row.asin).canonical,
      asinValid: inspectAmazonAsin(row.asin).valid,
      title: optionalText(row.title, 'title', 500) ?? '',
      bullets: parseStringArray(row.bullets_json, 20, 2_000),
      description: optionalText(row.description, 'description', 20_000) ?? '',
      aPlus: optionalText(row.a_plus, 'aPlus', 20_000) ?? '',
      imageCopy: optionalText(row.image_copy, 'imageCopy', 20_000) ?? '',
      backendTerms: optionalText(row.backend_terms, 'backendTerms', 5_000) ?? '',
      source: optionalText(row.source, 'source', 80) ?? 'manual',
      versionLabel: optionalText(row.version_label, 'versionLabel', 160) ?? '',
      changeSummary: optionalText(row.change_summary, 'changeSummary', 1_000) ?? '',
      createdAt: nonEmptyString(row.created_at) ?? '',
    }));
  }

  private authorize(contextInput: StoreContextEnvelope): StoreRecord {
    const context = this.storeCoordinator.assertActiveStoreContext(contextInput);
    const store = this.storeCoordinator.getStore(context.storeId);
    if (context.marketplace !== 'US' || store.marketplace !== 'US') {
      throw new StoreScopedAdListingError('STORE_IDENTITY_MISMATCH', 'V1 supports Amazon US only');
    }
    if (context.currency !== 'USD' || store.currency !== 'USD') {
      throw new StoreScopedAdListingError('STORE_IDENTITY_MISMATCH', 'V1 supports USD only');
    }
    return store;
  }

  private assertIdentityHints(store: StoreRecord, value: Record<string, unknown>): void {
    for (const input of [value.storeName, value.store_name].filter((item) => item !== undefined)) {
      if (normalizeIdentity(input) !== normalizeIdentity(store.displayName)) {
        throw identityMismatch('Renderer store name does not match Main store authority');
      }
    }
    for (const input of [value.marketplace, value.marketplaceCode, value.marketplace_code]
      .filter((item) => item !== undefined)) {
      if (String(input).trim().toUpperCase() !== 'US') {
        throw identityMismatch('Renderer marketplace does not match Main US authority');
      }
    }
    if (value.currency !== undefined && String(value.currency).trim().toUpperCase() !== 'USD') {
      throw identityMismatch('Renderer currency does not match Main USD authority');
    }
  }

  private findListingById(storeId: StoreId, id: number): ListingRow | undefined {
    return this.db.prepare(`
      SELECT listing.*
      FROM listing_content listing
      WHERE listing.store_id = ? AND listing.id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM store_migration_quarantine quarantine
          WHERE quarantine.source_table = 'listing_content'
            AND quarantine.source_row_id = CAST(listing.id AS TEXT)
            AND quarantine.status = 'pending'
        )
    `)
      .get(storeId, id) as ListingRow | undefined;
  }

  private findListingByAsin(storeId: StoreId, asin: string): ListingRow | undefined {
    return this.db.prepare(`
      SELECT listing.*
      FROM listing_content listing
      WHERE listing.store_id = ? AND upper(trim(listing.asin)) = ?
        AND NOT EXISTS (
          SELECT 1
          FROM store_migration_quarantine quarantine
          WHERE quarantine.source_table = 'listing_content'
            AND quarantine.source_row_id = CAST(listing.id AS TEXT)
            AND quarantine.status = 'pending'
        )
      ORDER BY listing.updated_at DESC, listing.id DESC
      LIMIT 1
    `).get(storeId, asin) as ListingRow | undefined;
  }

  private projectListing(store: StoreRecord, row: ListingRow): VersionedStoreListingContent {
    const asin = inspectAmazonAsin(row.asin);
    const listing = {
      id: Number(row.id),
      storeId: store.storeId,
      storeName: store.displayName,
      marketplace: 'US' as const,
      currency: 'USD' as const,
      asin: asin.canonical,
      asinValid: asin.valid,
      title: row.title ?? '',
      bullets: parseStringArray(row.bullets_json, 20, 2_000),
      description: row.description ?? '',
      aPlus: row.a_plus ?? '',
      imageCopy: row.image_copy ?? '',
      backendTerms: row.backend_terms ?? '',
      source: row.source ?? 'manual',
      versionLabel: row.version_label ?? '',
      changeSummary: row.change_summary ?? '',
      createdAt: row.created_at ?? '',
      updatedAt: row.updated_at ?? '',
    };
    return { ...listing, revision: listingRevision(listing) };
  }

  private insertListingVersion(store: StoreRecord, row: ListingRow): void {
    const result = this.db.prepare(`
      INSERT INTO listing_content_versions (
        store_id, listing_content_id, asin, store_name, marketplace_code,
        title, bullets_json, description, a_plus, image_copy, backend_terms,
        source, version_label, change_summary, created_at
      ) VALUES (?, ?, ?, ?, 'US', ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW})
    `).run(
      store.storeId,
      row.id,
      inspectAmazonAsin(row.asin).canonical,
      store.displayName,
      row.title ?? '',
      row.bullets_json ?? '[]',
      row.description ?? '',
      row.a_plus ?? '',
      row.image_copy ?? '',
      row.backend_terms ?? '',
      row.source ?? 'manual',
      row.version_label ?? '',
      row.change_summary ?? '',
    );
    if (result.changes !== 1) throw writeFailed('listing content version was not persisted');
  }
}

const SQL_NOW = "strftime('%Y-%m-%d %H:%M:%f', 'now')";
const IDENTITY_HINT_KEYS = new Set([
  'storeName',
  'store_name',
  'marketplace',
  'marketplaceCode',
  'marketplace_code',
  'currency',
]);
const AD_OBJECT_LIST_KEYS = new Set([
  ...IDENTITY_HINT_KEYS,
  'kind',
  'dateFrom',
  'dateTo',
  'asin',
  'query',
  'limit',
]);
const KEYWORD_FACT_LIST_KEYS = new Set([...IDENTITY_HINT_KEYS, 'asin', 'query', 'limit']);
const LISTING_LIST_KEYS = new Set([...IDENTITY_HINT_KEYS, 'asin', 'query', 'limit']);
const LISTING_LOOKUP_KEYS = new Set([...IDENTITY_HINT_KEYS, 'id', 'asin']);
const LISTING_EDITABLE_KEYS = [
  'asin',
  'title',
  'bullets',
  'description',
  'aPlus',
  'a_plus',
  'imageCopy',
  'image_copy',
  'backendTerms',
  'backend_terms',
  'source',
  'versionLabel',
  'version_label',
  'changeSummary',
  'change_summary',
] as const;
const LISTING_CREATE_KEYS = new Set([...IDENTITY_HINT_KEYS, ...LISTING_EDITABLE_KEYS]);
const LISTING_PATCH_KEYS = new Set([...IDENTITY_HINT_KEYS, ...LISTING_EDITABLE_KEYS]);
const LISTING_UPDATE_KEYS = new Set(['id', 'expectedRevision', 'patch']);
const LISTING_DELETE_KEYS = new Set(['id', 'expectedRevision']);
const LISTING_VERSION_LIST_KEYS = new Set([
  ...IDENTITY_HINT_KEYS,
  'listingContentId',
  'asin',
  'limit',
  'offset',
]);

const AD_OBJECT_SHAPES: Record<StoreScopedAdObjectKind, {
  reportTypes: readonly LingxingReportType[];
  nameExpression: string;
  campaignExpression: string;
  adGroupExpression: string;
  matchTypeExpression: string;
  groupBy: string[];
  searchExpressions: string[];
}> = {
  campaign: {
    reportTypes: ['campaign'],
    nameExpression: 'campaign_name',
    campaignExpression: 'campaign_name',
    adGroupExpression: 'NULL',
    matchTypeExpression: 'NULL',
    groupBy: ['campaign_name'],
    searchExpressions: ['campaign_name'],
  },
  ad_group: {
    reportTypes: ['ad_group'],
    nameExpression: 'ad_group_name',
    campaignExpression: 'campaign_name',
    adGroupExpression: 'ad_group_name',
    matchTypeExpression: 'NULL',
    groupBy: ['campaign_name', 'ad_group_name'],
    searchExpressions: ['campaign_name', 'ad_group_name'],
  },
  target: {
    reportTypes: ['keyword', 'product_targeting', 'auto_targeting'],
    nameExpression: 'targeting',
    campaignExpression: 'campaign_name',
    adGroupExpression: 'ad_group_name',
    matchTypeExpression: `CASE
      WHEN report_type = 'keyword'
      THEN NULLIF(lower(trim(match_type)), '')
      ELSE NULL
    END`,
    groupBy: [
      'report_type',
      'campaign_name',
      'ad_group_name',
      'targeting',
      `CASE
        WHEN report_type = 'keyword'
        THEN NULLIF(lower(trim(match_type)), '')
        ELSE NULL
      END`,
    ],
    searchExpressions: ['campaign_name', 'ad_group_name', 'targeting', 'match_type'],
  },
  search_term: {
    reportTypes: ['user_search_term'],
    nameExpression: 'search_term',
    campaignExpression: 'campaign_name',
    adGroupExpression: 'ad_group_name',
    matchTypeExpression: 'NULL',
    groupBy: ['campaign_name', 'ad_group_name', 'search_term'],
    searchExpressions: ['campaign_name', 'ad_group_name', 'search_term'],
  },
};

const PRODUCTION_REPORT_TYPES: readonly LingxingReportType[] = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
];
const PRODUCTION_REPORT_TYPE_SET = new Set<string>(PRODUCTION_REPORT_TYPES);

function isLingxingReportType(value: unknown): value is LingxingReportType {
  return PRODUCTION_REPORT_TYPE_SET.has(String(value ?? '').trim());
}

function parseProductionLineageJob(row: ProductionLineageJobRow): ProductionLineageJob | undefined {
  const reportTypes = safeReportTypes(row.report_types_json);
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.snapshot_json);
  } catch {
    return undefined;
  }
  const lineage = safeProductionLineage(
    snapshot && typeof snapshot === 'object'
      ? (snapshot as Record<string, unknown>).lineage
      : undefined,
  );
  return {
    jobId: String(row.job_id),
    dateStart: String(row.date_start),
    dateEnd: String(row.date_end),
    reportTypes,
    lineage,
    createdAt: String(row.created_at),
  };
}

function safeReportTypes(value: string): LingxingReportType[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => !isLingxingReportType(item))) return [];
    return parsed.map((item) => String(item) as LingxingReportType);
  } catch {
    return [];
  }
}

function safeProductionLineage(value: unknown): ProductionLineage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const purpose = String(record.purpose ?? '');
  const expectedReportTypes = Array.isArray(record.expectedReportTypes)
    && record.expectedReportTypes.every(isLingxingReportType)
    ? record.expectedReportTypes.map((item) => String(item) as LingxingReportType)
    : [];
  if (purpose !== 'production_full' && purpose !== 'resume' && purpose !== 'retry') return undefined;
  const lineageId = String(record.lineageId ?? '');
  const rootJobId = String(record.rootJobId ?? '');
  const parentJobId = record.parentJobId === undefined ? undefined : String(record.parentJobId);
  if (!lineageId || !rootJobId || (record.parentJobId !== undefined && !parentJobId)) return undefined;
  return {
    lineageId,
    rootJobId,
    parentJobId,
    expectedReportTypes,
    purpose,
  };
}

function hasCompleteReportTypeSet(values: Iterable<LingxingReportType>): boolean {
  const reportTypes = [...values];
  return reportTypes.length === PRODUCTION_REPORT_TYPES.length
    && new Set(reportTypes).size === PRODUCTION_REPORT_TYPES.length
    && PRODUCTION_REPORT_TYPES.every((reportType) => reportTypes.includes(reportType));
}

function isValidProductionRoot(job: ProductionLineageJob): boolean {
  const lineage = job.lineage;
  return hasCompleteReportTypeSet(job.reportTypes)
    && Boolean(lineage)
    && lineage!.lineageId === job.jobId
    && lineage!.rootJobId === job.jobId
    && lineage!.parentJobId === undefined
    && lineage!.purpose === 'production_full'
    && hasCompleteReportTypeSet(lineage!.expectedReportTypes);
}

function validatedProductionLineageFamily(
  root: ProductionLineageJob,
  candidates: readonly ProductionLineageJob[],
): ProductionLineageJob[] {
  const byId = new Map(candidates.map((job) => [job.jobId, job]));
  const valid = new Map<string, boolean>([[root.jobId, true]]);
  const isValidMember = (job: ProductionLineageJob, visiting = new Set<string>()): boolean => {
    const cached = valid.get(job.jobId);
    if (cached !== undefined) return cached;
    const lineage = job.lineage;
    if (
      !lineage
      || lineage.lineageId !== root.jobId
      || lineage.rootJobId !== root.jobId
      || !lineage.parentJobId
      || (lineage.purpose !== 'resume' && lineage.purpose !== 'retry')
      || !hasCompleteReportTypeSet(lineage.expectedReportTypes)
      || job.dateStart !== root.dateStart
      || job.dateEnd !== root.dateEnd
      || job.reportTypes.length < 1
      || new Set(job.reportTypes).size !== job.reportTypes.length
      || job.reportTypes.some((reportType) => !PRODUCTION_REPORT_TYPE_SET.has(reportType))
      || visiting.has(job.jobId)
    ) {
      valid.set(job.jobId, false);
      return false;
    }
    const parent = byId.get(lineage.parentJobId);
    if (!parent) {
      valid.set(job.jobId, false);
      return false;
    }
    const parentValid = parent.jobId === root.jobId
      || isValidMember(parent, new Set(visiting).add(job.jobId));
    valid.set(job.jobId, parentValid);
    return parentValid;
  };
  return candidates.filter((job) => job.jobId === root.jobId || isValidMember(job));
}

function normalizeAdObjectKind(value: unknown): StoreScopedAdObjectKind {
  if (value === undefined) return 'campaign';
  if (value === 'campaign' || value === 'ad_group' || value === 'target' || value === 'search_term') {
    return value;
  }
  throw invalid('kind must be campaign, ad_group, target, or search_term');
}

function normalizeListingCreate(input: Record<string, unknown>) {
  return {
    asin: normalizeAsinForWrite(input.asin),
    title: optionalText(input.title, 'title', 500) ?? '',
    bullets: normalizeStringArray(input.bullets, 'bullets', 10, 2_000),
    description: optionalText(input.description, 'description', 20_000) ?? '',
    aPlus: optionalText(input.aPlus ?? input.a_plus, 'aPlus', 20_000) ?? '',
    imageCopy: optionalText(input.imageCopy ?? input.image_copy, 'imageCopy', 20_000) ?? '',
    backendTerms: optionalText(input.backendTerms ?? input.backend_terms, 'backendTerms', 5_000) ?? '',
    source: optionalText(input.source, 'source', 80) ?? 'manual',
    versionLabel: optionalText(input.versionLabel ?? input.version_label, 'versionLabel', 160) ?? '',
    changeSummary: optionalText(input.changeSummary ?? input.change_summary, 'changeSummary', 1_000) ?? '',
  };
}

function mergeListingPatch(
  current: VersionedStoreListingContent,
  patch: Record<string, unknown>,
) {
  return {
    title: patch.title === undefined ? current.title : optionalText(patch.title, 'title', 500) ?? '',
    bullets: patch.bullets === undefined
      ? current.bullets
      : normalizeStringArray(patch.bullets, 'bullets', 10, 2_000),
    description: patch.description === undefined
      ? current.description
      : optionalText(patch.description, 'description', 20_000) ?? '',
    aPlus: patch.aPlus === undefined && patch.a_plus === undefined
      ? current.aPlus
      : optionalText(patch.aPlus ?? patch.a_plus, 'aPlus', 20_000) ?? '',
    imageCopy: patch.imageCopy === undefined && patch.image_copy === undefined
      ? current.imageCopy
      : optionalText(patch.imageCopy ?? patch.image_copy, 'imageCopy', 20_000) ?? '',
    backendTerms: patch.backendTerms === undefined && patch.backend_terms === undefined
      ? current.backendTerms
      : optionalText(patch.backendTerms ?? patch.backend_terms, 'backendTerms', 5_000) ?? '',
    source: patch.source === undefined
      ? current.source
      : optionalText(patch.source, 'source', 80) ?? 'manual',
    versionLabel: patch.versionLabel === undefined && patch.version_label === undefined
      ? current.versionLabel
      : optionalText(patch.versionLabel ?? patch.version_label, 'versionLabel', 160) ?? '',
    changeSummary: patch.changeSummary === undefined && patch.change_summary === undefined
      ? current.changeSummary
      : optionalText(patch.changeSummary ?? patch.change_summary, 'changeSummary', 1_000) ?? '',
  };
}

function listingRevision(input: Omit<VersionedStoreListingContent, 'revision'>): string {
  return `listing-content-v1:${createHash('sha256').update(JSON.stringify({
    id: input.id,
    storeId: input.storeId,
    asin: input.asin,
    asinValid: input.asinValid,
    title: input.title,
    bullets: input.bullets,
    description: input.description,
    aPlus: input.aPlus,
    imageCopy: input.imageCopy,
    backendTerms: input.backendTerms,
    source: input.source,
    versionLabel: input.versionLabel,
    changeSummary: input.changeSummary,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  })).digest('hex')}`;
}

function assertExpectedRevision(value: unknown, actual: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StoreScopedAdListingError(
      'CAS_REQUIRED',
      'expectedRevision is required for Listing update and delete',
    );
  }
  if (value !== actual) {
    throw new StoreScopedAdListingError('OBJECT_CONFLICT', 'Listing content changed after it was read');
  }
}

function adObjectKey(
  kind: StoreScopedAdObjectKind,
  campaignName: string | undefined,
  adGroupName: string | undefined,
  name: string,
  reportType?: string,
  matchType?: string,
): string {
  const parts = reportType
    ? [kind, reportType, campaignName ?? '', adGroupName ?? '', name, ...(matchType ? [matchType] : [])]
    : [kind, campaignName ?? '', adGroupName ?? '', name];
  return parts
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function stableAdEntityPathKey(
  reportType: unknown,
  campaignName: unknown,
  adGroupName: unknown,
  entityName: unknown,
  matchType?: unknown,
): string {
  return [reportType, campaignName, adGroupName, entityName, matchType]
    .map(normalizeIdentity)
    .join('\u0000');
}

function readableTargetName(
  rawName: string,
  reportType: string | undefined,
  matchType: string | undefined,
): string {
  if (reportType !== 'keyword' || !matchType) return rawName;
  const label = keywordMatchTypeLabel(matchType);
  return `${rawName}（${label}）`;
}

function keywordMatchTypeLabel(matchType: string): string {
  const normalized = normalizeIdentity(matchType);
  if (normalized === 'exact' || normalized === 'exact match' || normalized === '精准') {
    return '精准匹配';
  }
  if (normalized === 'phrase' || normalized === 'phrase match' || normalized === '词组') {
    return '词组匹配';
  }
  if (normalized === 'broad' || normalized === 'broad match' || normalized === '广泛') {
    return '广泛匹配';
  }
  return '其他匹配方式';
}

function uniqueStableAdEntityAuthority(
  candidates: readonly StableAdEntityAuthority[] | undefined,
): StableAdEntityAuthority | undefined {
  if (!candidates || candidates.length !== 1) return undefined;
  return candidates[0];
}

function canonicalKeywordIdentityFromRow(
  row: StableAdEntityAuthorityRow,
): CanonicalKeywordIdentity | undefined {
  const adsAccountId = nonEmptyString(row.ads_account_id);
  const campaignId = nonEmptyString(row.campaign_id);
  const adGroupId = nonEmptyString(row.ad_group_id);
  const keywordId = nonEmptyString(row.keyword_id);
  const objectRevision = Number(row.object_revision);
  if (
    !adsAccountId
    || !campaignId
    || !adGroupId
    || !keywordId
    || !Number.isInteger(objectRevision)
    || objectRevision < 1
  ) return undefined;
  return { adsAccountId, campaignId, adGroupId, keywordId, objectRevision };
}

function keywordFactKey(asin: string | undefined, keyword: string): string {
  return `${asin ?? ''}\u0000${keyword.toLocaleLowerCase()}`;
}

function normalizeKeyword(value: unknown): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (!normalized) throw invalid('keyword must not be empty');
  return normalized;
}

function normalizeAsin(value: unknown): string {
  const inspection = inspectAmazonAsin(value);
  if (!inspection.canonical) throw invalid('ASIN must not be empty');
  return inspection.canonical;
}

function normalizeAsinForWrite(value: unknown): string {
  try {
    return canonicalizeAmazonAsin(value);
  } catch {
    throw invalid('ASIN must be exactly 10 ASCII letters or digits');
  }
}

function optionalAsin(value: unknown): string | undefined {
  return value === undefined || value === null || String(value).trim() === ''
    ? undefined
    : normalizeAsin(value);
}

function isSqliteConstraint(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT');
}

function optionalIsoDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw invalid(`${label} must be YYYY-MM-DD`);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw invalid(`${label} must be a real calendar date`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(`${label} must be text`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw invalid(`${label} is longer than ${maxLength} characters`);
  return normalized;
}

function boundedOptionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = nonEmptyString(value);
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${label} must be an array of text`);
  if (value.length > maxItems) throw invalid(`${label} cannot contain more than ${maxItems} items`);
  return value.map((item, index) => {
    if (typeof item !== 'string') throw invalid(`${label}[${index}] must be text`);
    const normalized = item.trim();
    if (normalized.length > maxItemLength) {
      throw invalid(`${label}[${index}] is longer than ${maxItemLength} characters`);
    }
    return normalized;
  }).filter(Boolean);
}

function parseStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .slice(0, maxItems)
      .map((item) => item.trim().slice(0, maxItemLength))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function positiveLimit(value: unknown, defaultValue: number, max: number): number {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > max) {
    throw invalid(`limit must be an integer from 1 to ${max}`);
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) throw invalid(`${label} must be a positive integer`);
  return normalized;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw invalid(`${label} must be a non-negative integer`);
  }
  return normalized;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw invalid(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}

function finiteNumber(value: unknown): number {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function invalid(message: string): StoreScopedAdListingError {
  return new StoreScopedAdListingError('INVALID_INPUT', message);
}

function identityMismatch(message: string): StoreScopedAdListingError {
  return new StoreScopedAdListingError('STORE_IDENTITY_MISMATCH', message);
}

function notFound(label: string): StoreScopedAdListingError {
  return new StoreScopedAdListingError('OBJECT_NOT_FOUND', `${label} was not found in the active store`);
}

function writeFailed(message: string): StoreScopedAdListingError {
  return new StoreScopedAdListingError('WRITE_FAILED', message);
}
