import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import  {
  decodePolicyScopePart,
  decodePolicyScopeParts,
  scopeText,
  idOf,
  parseJson,
  stateConflict,
  referenceConflict,
} from './values';
import type { MissionDomainRepositoryContext } from './context';
export function assertProduct(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, productIdInput: string): void{
    const productId = idOf(productIdInput, 'productId');
    if (!this.references?.productBelongsToStore(context, productId)) {
      throw referenceConflict(
        '当前产品缺少此店铺的可信归属证据；请从当前店铺产品列表重新选择。',
      );
    }
  }

export function assertAdEntity(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, adEntityIdInput: string): void{
    const adEntityId = idOf(adEntityIdInput, 'adEntityId');
    const belongsToStore = this.references
      ? this.references.adEntityBelongsToStore(context, adEntityId)
      : Boolean(this.db.prepare(`
          SELECT 1 AS present
          FROM verified_ad_entity_authority
          WHERE store_id = ? AND ad_entity_id = ?
          ORDER BY entity_revision DESC
          LIMIT 1
        `).get(context.storeId, adEntityId));
    if (!belongsToStore) {
      throw referenceConflict(
        '当前广告对象缺少此店铺的可信身份与版本证据；请重新核验当前店铺广告对象。',
      );
    }
  }

export function assertAdEntities(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, entityIds: readonly string[]): void{
    for (const entityId of entityIds) this.assertAdEntity(context, entityId);
  }

export function adEntitySupportsKeywordBid(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    entityId: string,
  ): boolean{
    if (this.references?.adEntitySupportsKeywordBid) {
      return this.references.adEntitySupportsKeywordBid(context, entityId);
    }
    const authority = this.db.prepare(`
      SELECT entity_type AS entityType, source_report_type AS sourceReportType
      FROM verified_ad_entity_authority
      WHERE store_id = ? AND ad_entity_id = ?
      ORDER BY entity_revision DESC
      LIMIT 1
    `).get(context.storeId, entityId) as {
      entityType: string;
      sourceReportType: string;
    } | undefined;
    return authority?.entityType === 'keyword' && authority.sourceReportType === 'keyword';
  }

export function adEntityBelongsToPolicyScope(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    scope: string,
    entityId: string,
  ): boolean{
    let level: 'store' | 'product' | 'campaign' | 'ad_group' | 'keyword';
    let token = '';
    if (scope === 'store' || scope === 'sponsored-products-keywords') {
      level = 'store';
    } else {
      const separator = scope.indexOf(':');

      if (separator < 0) return false;
      const candidateLevel = scope.slice(0, separator);
      if (!['product', 'campaign', 'ad_group', 'keyword'].includes(candidateLevel)) return false;
      level = candidateLevel as typeof level;
      token = scope.slice(separator + 1);
      if (!token) return false;
    }

    const authorities = this.db.prepare(`
      SELECT verified.entity_name AS entityName,
             verified.campaign_name AS campaignName,
             verified.ad_group_name AS adGroupName,
             verified.authority_id AS authorityId,
             verified.proof_sha256 AS authorityProofSha256,
             verified.entity_revision AS entityRevision,
             verified.entity_type AS entityType,
             verified.source_report_type AS sourceReportType,
             verified.source_file_hash AS sourceFileHash,
             verified.source_row AS sourceRow,
             evidence.data_batch_id AS dataBatchId,
             evidence.import_run_id AS importRunId,
             metrics.asin AS asin
      FROM verified_ad_entity_authority verified
      JOIN analysis_evidence_packages evidence
        ON evidence.store_id = verified.store_id
       AND evidence.id = verified.evidence_package_id
      JOIN report_import_runs runs
        ON runs.store_id = evidence.store_id
       AND runs.run_id = evidence.import_run_id
       AND runs.batch_id = evidence.data_batch_id
       AND runs.status = 'completed'
      JOIN report_import_file_snapshots snapshots
        ON snapshots.store_id = runs.store_id
       AND snapshots.run_id = runs.run_id
       AND snapshots.batch_id = runs.batch_id
       AND snapshots.report_type = verified.source_report_type
       AND snapshots.file_hash = verified.source_file_hash
       AND snapshots.report_file_id IS NOT NULL
      JOIN ad_daily_metrics metrics
        ON metrics.store_id = evidence.store_id
       AND metrics.batch_id = evidence.data_batch_id
       AND metrics.report_type = verified.source_report_type
       AND metrics.source_file = snapshots.file_path
       AND metrics.source_row = verified.source_row
       AND metrics.store_authority_quarantined = 0
      WHERE verified.store_id = ?
        AND verified.ad_entity_id = ?
        AND verified.entity_type = 'keyword'
        AND verified.source_report_type = 'keyword'
        AND lower(trim(metrics.campaign_name)) = lower(trim(verified.campaign_name))
        AND lower(trim(metrics.ad_group_name)) = lower(trim(verified.ad_group_name))
        AND lower(trim(metrics.targeting)) = lower(trim(verified.entity_name))
        AND NOT EXISTS (
          SELECT 1
          FROM store_migration_quarantine quarantine
          WHERE quarantine.source_table = 'ad_daily_metrics'
            AND quarantine.source_row_id = CAST(metrics.id AS TEXT)
            AND quarantine.status = 'pending'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM verified_ad_entity_authority newer_authority
          WHERE newer_authority.store_id = verified.store_id
            AND newer_authority.ad_entity_id = verified.ad_entity_id
            AND newer_authority.entity_revision > verified.entity_revision
        )
        AND NOT EXISTS (
          SELECT 1
          FROM report_import_runs newer_run
          JOIN report_import_file_snapshots newer_snapshot
            ON newer_snapshot.store_id = newer_run.store_id
           AND newer_snapshot.run_id = newer_run.run_id
           AND newer_snapshot.batch_id = newer_run.batch_id
          WHERE newer_run.store_id = runs.store_id
            AND newer_run.status = 'completed'
            AND newer_snapshot.report_type = snapshots.report_type
            AND (
              newer_run.completed_at > runs.completed_at
              OR (
                newer_run.completed_at = runs.completed_at
                AND newer_run.created_at > runs.created_at
              )
              OR (
                newer_run.completed_at = runs.completed_at
                AND newer_run.created_at = runs.created_at
                AND newer_run.run_id > runs.run_id
              )
            )
        )
      ORDER BY verified.entity_revision DESC, verified.authority_id DESC
    `).all(context.storeId, entityId) as Array<{
      entityName: string;
      campaignName: string;
      adGroupName: string;
      authorityId: string;
      authorityProofSha256: string;
      entityRevision: number;
      entityType: string;
      sourceReportType: string;
      sourceFileHash: string;
      sourceRow: number;
      dataBatchId: string;
      importRunId: string;
      asin: string | null;
    }>;
    if (authorities.length !== 1) return false;
    const authority = authorities[0]!;

    if (level === 'store') return true;
    if (level === 'keyword') return entityId === token;

    if (level === 'product') {
      const asin = decodePolicyScopePart(token)?.toUpperCase();
      if (!asin) return false;
      return scopeText(authority.asin) === scopeText(asin);
    }

    const parts = decodePolicyScopeParts(token);
    if (!parts) return false;

    const currentIdentities = this.db.prepare(`
      SELECT identity.ads_account_id AS adsAccountId,
             identity.campaign_id AS campaignId,
             identity.ad_group_id AS adGroupId
      FROM ad_keyword_identity_versions identity
      WHERE identity.store_id = ?
        AND identity.ad_entity_id = ?
        AND identity.entity_revision = ?
        AND identity.source_authority_id = ?
        AND identity.source_authority_proof_sha256 = ?
        AND identity.resolved_session_generation = ?
        AND NOT EXISTS (
          SELECT 1
          FROM ad_keyword_identity_versions newer
          WHERE newer.store_id = identity.store_id
            AND newer.canonical_keyword_id = identity.canonical_keyword_id
            AND newer.object_revision > identity.object_revision
        )
      ORDER BY identity.canonical_keyword_id,
               identity.object_revision DESC,
               identity.identity_version_id DESC
    `).all(
      context.storeId,
      entityId,
      authority.entityRevision,
      authority.authorityId,
      authority.authorityProofSha256,
      context.sessionGeneration,
    ) as Array<{
      adsAccountId: string;
      campaignId: string;
      adGroupId: string;
    }>;
    if (currentIdentities.length !== 1) return false;
    const identity = currentIdentities[0]!;
    if (level === 'campaign') {
      return parts.length === 2
        && Boolean(parts[0] && parts[1])
        && identity.adsAccountId === parts[0]
        && identity.campaignId === parts[1];
    }
    return parts.length === 3
      && Boolean(parts[0] && parts[1] && parts[2])
      && identity.adsAccountId === parts[0]
      && identity.campaignId === parts[1]
      && identity.adGroupId === parts[2];
  }

export function requireCompletedDataBatch(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string, requireFormal = false): string | undefined{
    const id = idOf(idInput, 'dataBatchId');
    const row = this.db.prepare(`
      SELECT status, request_id AS requestId, date_end AS dateEnd
      FROM lingxing_report_batches
      WHERE store_id = ? AND id = ?
    `).get(context.storeId, id) as { status: string; requestId: string | null; dateEnd: string } | undefined;
    if (!row) throw referenceConflict(`Data batch ${id} does not belong to store ${context.storeId}.`);
    if (row.status !== 'completed') throw stateConflict(`Data batch ${id} is ${row.status}; Mission authority requires completed data.`);

    const exactReportTypes = [
      'campaign',
      'ad_group',
      'placement',
      'advertised_product',
      'auto_targeting',
      'keyword',
      'product_targeting',
      'user_search_term',
    ] as const;
    const exactImport = this.db.prepare(`
      SELECT runs.run_id AS runId
      FROM report_import_runs runs
      JOIN report_import_file_snapshots snapshots
        ON snapshots.store_id = runs.store_id
       AND snapshots.run_id = runs.run_id
       AND snapshots.batch_id = runs.batch_id
       AND snapshots.report_file_id IS NOT NULL
      WHERE runs.store_id = ?
        AND runs.batch_id = ?
        AND runs.status = 'completed'
        AND runs.source_file_count = 8
        AND runs.reconciliation_count = 8
      GROUP BY runs.run_id
      HAVING COUNT(*) = 8
        AND COUNT(DISTINCT snapshots.report_type) = 8
        AND COUNT(DISTINCT CASE
          WHEN snapshots.report_type IN (
            'campaign', 'ad_group', 'placement', 'advertised_product',
            'auto_targeting', 'keyword', 'product_targeting', 'user_search_term'
          ) THEN snapshots.report_type
        END) = 8
      ORDER BY runs.completed_at DESC, runs.created_at DESC, runs.run_id DESC
      LIMIT 1
    `).get(context.storeId, id) as { runId: string } | undefined;

    if (!exactImport) {
      if (requireFormal) throw stateConflict('经营实验需要同批次完整 8 类报表入库与对账；请先完成正式采集。');
      return;
    }
    if (requireFormal) {
      const latest = this.db.prepare(`SELECT run_id AS runId FROM report_import_runs
        WHERE store_id=? AND batch_id=? AND status='completed'
        ORDER BY completed_at DESC, created_at DESC, run_id DESC LIMIT 1`).get(context.storeId, id) as { runId: string };
      const reconciliations = this.db.prepare(`SELECT report_type AS reportType, metric_date AS metricDate,
        status, within_tolerance AS withinTolerance, expected_rows AS expectedRows, actual_rows AS actualRows
        FROM report_import_reconciliations WHERE store_id=? AND run_id=? AND batch_id=?`)
        .all(context.storeId, exactImport.runId, id) as Array<{ reportType: string; metricDate: string; status: string; withinTolerance: number; expectedRows: number; actualRows: number }>;
      if (latest.runId !== exactImport.runId || reconciliations.length !== 8
        || new Set(reconciliations.map(item => item.reportType)).size !== 8
        || reconciliations.some(item => !exactReportTypes.includes(item.reportType as typeof exactReportTypes[number])
          || item.metricDate !== row.dateEnd || item.status !== 'matched' || item.withinTolerance !== 1 || item.expectedRows !== item.actualRows)) {
        throw stateConflict('最新导入缺少完整八报表对账，不能沿用旧批次快照；请重新采集并核对。');
      }
    }

    const jobRow = this.db.prepare(`
      SELECT snapshot_json AS snapshotJson
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(context.storeId, id) as { snapshotJson: string } | undefined;
    const checkpoint = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT report_type) AS distinctTypes,
        SUM(CASE WHEN state = 'downloaded' THEN 1 ELSE 0 END) AS downloaded
      FROM lingxing_collection_report_checkpoints
      WHERE store_id = ? AND job_id = ?
    `).get(context.storeId, id) as {
      total: number;
      distinctTypes: number;
      downloaded: number;
    };
    const job = jobRow ? parseJson<{
      jobId?: string;
      state?: string;
      importState?: string;
      completedAt?: string;
      importCompletedAt?: string;
      request?: { requestId?: string; reportTypes?: unknown };
      lineage?: {
        lineageId?: string;
        rootJobId?: string;
        parentJobId?: string;
        expectedReportTypes?: unknown;
        purpose?: string;
      };
    }>(jobRow.snapshotJson) : undefined;
    const exactSet = (value: unknown): boolean => {
      if (!Array.isArray(value)) return false;
      const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
      return normalized.length === exactReportTypes.length
        && new Set(normalized).size === exactReportTypes.length
        && exactReportTypes.every((reportType) => normalized.includes(reportType));
    };
    const persistedRequestId = row.requestId?.trim() ?? '';
    const jobRequestId = job?.request?.requestId?.trim() ?? '';
    const productionRootReady = job?.jobId === id
      && Boolean(persistedRequestId)
      && jobRequestId === persistedRequestId
      && !jobRequestId.startsWith('local-import:')
      && !jobRequestId.startsWith('canary:')
      && job.state === 'completed'
      && job.importState === 'succeeded'
      && Boolean(job.completedAt)
      && Boolean(job.importCompletedAt)
      && job.lineage?.purpose === 'production_full'
      && job.lineage.lineageId === id
      && job.lineage.rootJobId === id
      && job.lineage.parentJobId === undefined
      && exactSet(job.request?.reportTypes)
      && exactSet(job.lineage.expectedReportTypes)
      && Number(checkpoint.total) === exactReportTypes.length
      && Number(checkpoint.distinctTypes) === exactReportTypes.length
      && Number(checkpoint.downloaded) === exactReportTypes.length;
    if (!productionRootReady) {
      throw stateConflict(
        '运营任务数据批次缺少已成功入库的 production_full 完整 8 类采集根证据；'
        + '请先启动完整 8 类采集并等待入库成功。',
      );
    }
    return exactImport.runId;
  }
